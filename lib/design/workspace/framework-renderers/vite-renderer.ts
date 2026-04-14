/**
 * Vite Framework Renderer
 *
 * Handles frameworks that use Vite as their dev server (Vue, Svelte, Nuxt,
 * SvelteKit, Astro). Spawns `npx vite` in the worktree and proxies the
 * dev server output to the design workspace preview iframe.
 */

import type { FrameworkRenderer, RendererContext, RendererOutput } from "./types";
import type { FrameworkType } from "../project-detection";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { InspectorProxy } from "./inspector-proxy";
import { findAvailablePort } from "./port-utils";

const IS_WINDOWS = process.platform === "win32";

export class ViteRenderer implements FrameworkRenderer {
  readonly frameworks: FrameworkType[] = ["vue", "nuxt", "svelte", "sveltekit", "astro"];
  readonly tier = "dev-server" as const;

  private process: ChildProcess | null = null;
  private port: number | null = null;
  private baseUrl: string | null = null;
  private ctx: RendererContext | null = null;
  private healthy = false;
  private inspectorProxy: InspectorProxy | null = null;

  /** The inspector proxy URL — use this instead of baseUrl for preview iframes */
  get inspectorProxyUrl(): string | null {
    return this.inspectorProxy?.getProxyUrl() ?? null;
  }

  async startup(ctx: RendererContext): Promise<void> {
    this.ctx = ctx;

    // Find an available port
    this.port = await findAvailablePort(3100, 3200);

    // Retry with new ports on EADDRINUSE (W3 — port TOCTOU race)
    const MAX_PORT_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
      if (attempt > 0) {
        this.port = await findAvailablePort(this.port! + 1, 3200);
      }

      // Determine the correct dev command with current port
      const { command, args } = this.getDevCommand(ctx);

      // Spawn the dev server
      this.process = spawn(command, [...args], {
        cwd: ctx.worktreePath,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(this.port),
        },
        shell: IS_WINDOWS,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Consume stdout/stderr to prevent buffer blocking (W4)
      this.process.stdout?.resume();
      this.process.stderr?.resume();

      this.baseUrl = `http://127.0.0.1:${this.port}`;

      try {
        // Wait for the dev server to be ready
        await this.waitForReady(ctx.config.devServerTimeoutMs);

        // Start inspector proxy targeting the dev server
        this.inspectorProxy = new InspectorProxy();
        await this.inspectorProxy.startup(this.baseUrl!);

        this.healthy = true;
        return;
      } catch (err) {
        // Kill the spawned process on failure (C10 — prevent process leaks)
        try { this.process.kill("SIGKILL"); } catch { /* already dead */ }
        this.process = null;

        // Retry only on port-related failures
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_PORT_RETRIES - 1 && msg.includes("exited with code")) {
          continue;
        }
        throw err;
      }
    }
  }

  async render(targetFile: string, mode: "page" | "component" | "route"): Promise<RendererOutput> {
    if (!this.baseUrl) {
      throw new Error("Vite renderer not started. Call startup() first.");
    }

    // For route mode, use the route path directly
    // For page/component mode, derive the URL from the file path
    let url = this.baseUrl;
    if (mode === "route" && targetFile.startsWith("/")) {
      url = `${this.baseUrl}${targetFile}`;
    } else {
      // Convert file path to URL path
      const routePath = this.fileToRoute(targetFile);
      url = `${this.baseUrl}${routePath}`;
    }

    // Return the inspector proxy URL so the preview iframe loads through
    // the proxy (which injects the inspector script into HTML responses).
    // The raw dev-server URL is kept as proxyUrl for internal reference.
    const proxyBase = this.inspectorProxyUrl;
    const proxyUrl = proxyBase
      ? url.replace(this.baseUrl!, proxyBase)
      : url;

    return {
      proxyUrl: proxyUrl,
    };
  }

  async rerender(targetFile: string, _changedCode: string): Promise<RendererOutput> {
    // Vite has HMR — just re-render with same URL, changes auto-propagate
    return this.render(targetFile, "page");
  }

  isHealthy(): boolean {
    return this.healthy && this.process !== null && this.process.exitCode === null;
  }

  async shutdown(): Promise<void> {
    this.healthy = false;
    // Shut down inspector proxy first
    if (this.inspectorProxy) {
      try { await this.inspectorProxy.shutdown(); } catch { /* ignore */ }
      this.inspectorProxy = null;
    }
    if (this.process) {
      try {
        // Send SIGTERM, then force-kill after 5s
        this.process.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            try { this.process?.kill("SIGKILL"); } catch { /* already dead */ }
            resolve();
          }, 5000);
          this.process?.on("exit", () => { clearTimeout(timer); resolve(); });
        });
      } catch { /* already dead */ }
      this.process = null;
    }
    this.port = null;
    this.baseUrl = null;
    this.ctx = null;
  }

  private getDevCommand(ctx: RendererContext): { command: string; args: string[] } {
    const npmCmd = IS_WINDOWS ? "npx.cmd" : "npx";

    // Check if the project has a dev script in package.json
    // Default to npx vite with the appropriate port
    switch (ctx.framework.type) {
      case "nuxt":
        return { command: npmCmd, args: ["nuxi", "dev", "--port", String(this.port)] };
      case "astro":
        return { command: npmCmd, args: ["astro", "dev", "--port", String(this.port)] };
      default:
        return { command: npmCmd, args: ["vite", "--port", String(this.port), "--host", "127.0.0.1"] };
    }
  }

  private fileToRoute(targetFile: string): string {
    // Convert file paths to routes based on common conventions
    // pages/about.vue → /about
    // src/views/Dashboard.vue → /dashboard
    let route = targetFile
      .replace(/^(src\/)?(pages|views|routes)\//, "/")
      .replace(/\.(vue|svelte|astro|tsx|jsx)$/, "")
      .replace(/\/index$/, "/");

    if (!route.startsWith("/")) route = "/" + route;
    return route;
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(this.baseUrl!, { signal: AbortSignal.timeout(2000) });
        if (response.ok || response.status === 404) {
          // Server is responding (404 is OK — means server is up but route doesn't exist)
          return;
        }
      } catch {
        // Not ready yet
      }

      // Check if process died
      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
        throw new Error(`Dev server exited with code ${this.process.exitCode}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    throw new Error(`Dev server did not start within ${timeoutMs}ms`);
  }
}

// Port allocation uses shared utility from ./port-utils.ts
