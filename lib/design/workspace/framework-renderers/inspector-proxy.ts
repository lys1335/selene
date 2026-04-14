/**
 * Inspector Proxy
 *
 * A lightweight HTTP proxy that sits between the design preview iframe and a
 * dev-server (Vite, PHP, etc.). It forwards all requests to the target server
 * and injects the design workspace inspector script into HTML responses.
 *
 * This eliminates the nested-iframe architecture that prevented the inspector
 * from reaching elements inside dev-server-backed previews.
 *
 * Features:
 * - HTML response rewriting (inject inspector `<script>` before `</body>`)
 * - WebSocket upgrade passthrough (preserves Vite HMR)
 * - Strips CSP headers that would block the injected script
 * - Requests uncompressed responses to avoid decompression overhead
 */

import http from "http";
import { Socket } from "net";
import zlib from "zlib";
import { getInspectorScript } from "../inspector-script";
import { findAvailablePort } from "./port-utils";

const PROXY_PORT_MIN = 4100;
const PROXY_PORT_MAX = 4200;

export class InspectorProxy {
  private server: http.Server | null = null;
  private proxyPort: number | null = null;
  private targetBaseUrl: string | null = null;
  /** Track upgraded WebSocket connections for clean shutdown (M2). */
  private activeWsSockets: Set<Socket> = new Set();

  /**
   * Start the inspector proxy targeting a dev server.
   * @param targetBaseUrl — The dev server URL (e.g. `http://127.0.0.1:3150`)
   * @returns The proxy port number
   */
  async startup(targetBaseUrl: string): Promise<number> {
    this.targetBaseUrl = targetBaseUrl;
    const target = new URL(targetBaseUrl);
    const targetHost = target.hostname;
    const targetPort = parseInt(target.port, 10);

    const inspectorScriptTag =
      `<script data-selene-inspector="proxy">${getInspectorScript("toggle")}<\/script>`;

    this.server = http.createServer((clientReq, clientRes) => {
      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...clientReq.headers,
        // Request uncompressed so we can inject without decompressing
        "accept-encoding": "identity",
      };
      // Remove host header so the target server sees its own host
      delete fwdHeaders["host"];

      const proxyOpts: http.RequestOptions = {
        hostname: targetHost,
        port: targetPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: fwdHeaders,
      };

      const proxyReq = http.request(proxyOpts, (proxyRes) => {
        const contentType = proxyRes.headers["content-type"] || "";
        const isHtml = contentType.includes("text/html");

        // M1: Skip body for HEAD and bodyless status codes
        const status = proxyRes.statusCode ?? 200;
        const isBodyless = clientReq.method === "HEAD" || status === 204 || status === 304;

        if (isHtml && !isBodyless) {
          // Buffer the HTML response, inject inspector script, send modified response.
          // M1: Handle content-encoding — some servers ignore accept-encoding: identity.
          const encoding = (proxyRes.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = proxyRes;
          if (encoding === "gzip") {
            stream = proxyRes.pipe(zlib.createGunzip());
          } else if (encoding === "br") {
            stream = proxyRes.pipe(zlib.createBrotliDecompress());
          } else if (encoding === "deflate") {
            stream = proxyRes.pipe(zlib.createInflate());
          }

          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            let html = Buffer.concat(chunks).toString("utf-8");
            html = injectIntoHtml(html, inspectorScriptTag);

            // Strip CSP and encoding headers (we decompressed and re-injected)
            const headers = { ...proxyRes.headers };
            delete headers["content-security-policy"];
            delete headers["content-security-policy-report-only"];
            delete headers["content-encoding"];
            delete headers["content-length"];
            headers["transfer-encoding"] = "chunked";

            clientRes.writeHead(proxyRes.statusCode ?? 200, headers);
            clientRes.end(html);
          });
        } else {
          // Non-HTML: stream through directly
          // Strip CSP from non-HTML too (some servers set it globally)
          const headers = { ...proxyRes.headers };
          delete headers["content-security-policy"];
          delete headers["content-security-policy-report-only"];

          clientRes.writeHead(proxyRes.statusCode ?? 200, headers);
          proxyRes.pipe(clientRes);
        }
      });

      proxyReq.on("error", (err) => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end(`Inspector proxy error: ${err.message}`);
        }
      });

      clientReq.pipe(proxyReq);
    });

    // WebSocket upgrade passthrough (for Vite HMR, etc.)
    // M2: Track active WebSocket connections for clean shutdown.
    this.server.on("upgrade", (req, socket, head) => {
      const clientSocket = socket as Socket;
      const proxySocket = new Socket();

      this.activeWsSockets.add(clientSocket);
      this.activeWsSockets.add(proxySocket);

      const cleanup = () => {
        this.activeWsSockets.delete(clientSocket);
        this.activeWsSockets.delete(proxySocket);
      };

      proxySocket.connect(targetPort, targetHost, () => {
        const reqLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
        const headerLines = Object.entries(req.headers)
          .filter(([key]) => key.toLowerCase() !== "host")
          .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(", ") : val}`)
          .join("\r\n");
        const hostHeader = `host: ${targetHost}:${targetPort}`;

        proxySocket.write(
          reqLine + hostHeader + "\r\n" + headerLines + "\r\n\r\n"
        );
        if (head.length) proxySocket.write(head);

        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);
      });

      proxySocket.on("error", () => {
        try { clientSocket.destroy(); } catch { /* ignore */ }
        cleanup();
      });
      clientSocket.on("error", () => {
        try { proxySocket.destroy(); } catch { /* ignore */ }
        cleanup();
      });
      proxySocket.on("close", cleanup);
      clientSocket.on("close", cleanup);
    });

    // Find an available port and start listening
    this.proxyPort = await findAvailablePort(PROXY_PORT_MIN, PROXY_PORT_MAX);

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.proxyPort!, "127.0.0.1", () => resolve());
      this.server!.on("error", reject);
    });

    return this.proxyPort;
  }

  /** Get the proxy URL (e.g. `http://127.0.0.1:4100`) */
  getProxyUrl(): string | null {
    return this.proxyPort ? `http://127.0.0.1:${this.proxyPort}` : null;
  }

  /** Get the proxy port */
  getProxyPort(): number | null {
    return this.proxyPort;
  }

  /** Shut down the proxy server and destroy all tracked connections (M2). */
  async shutdown(): Promise<void> {
    // Destroy all tracked WebSocket connections first
    for (const sock of this.activeWsSockets) {
      try { sock.destroy(); } catch { /* ignore */ }
    }
    this.activeWsSockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
        // Force-close all open connections after 2s
        setTimeout(() => {
          try { this.server?.closeAllConnections?.(); } catch { /* ignore */ }
          resolve();
        }, 2000);
      });
      this.server = null;
    }
    this.proxyPort = null;
    this.targetBaseUrl = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject an HTML string (script tag) before </body> or </html> or at end */
function injectIntoHtml(html: string, scriptTag: string): string {
  // Skip if already injected
  if (html.includes('data-selene-inspector="proxy"')) return html;

  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + scriptTag + html.slice(bodyClose);
  }
  const htmlClose = html.lastIndexOf("</html>");
  if (htmlClose !== -1) {
    return html.slice(0, htmlClose) + scriptTag + html.slice(htmlClose);
  }
  return html + scriptTag;
}

// Port allocation uses shared utility from ./port-utils.ts
