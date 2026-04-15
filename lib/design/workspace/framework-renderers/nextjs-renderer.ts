/**
 * Next.js Framework Renderer
 *
 * Dev-server-tier renderer for Next.js projects. Spawns `next dev` in
 * the project directory and proxies the output through InspectorProxy
 * so the design workspace iframe can display actual Next.js pages with
 * full framework support (App Router, Server Components, etc.).
 *
 * This avoids the esbuild compilation approach which cannot fully
 * replicate Next.js's module resolution and server-side features.
 */

import type { FrameworkRenderer, RendererContext, RendererOutput, RendererTier } from "./types";
import type { FrameworkType } from "../project-detection";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { InspectorProxy } from "./inspector-proxy";
import { findAvailablePort } from "./port-utils";

const IS_WINDOWS = process.platform === "win32";
const DEV_SERVER_PORT_MIN = 3200;
const DEV_SERVER_PORT_MAX = 3300;

export class NextjsRenderer implements FrameworkRenderer {
  readonly frameworks: FrameworkType[] = ["nextjs"];
  readonly tier: RendererTier = "dev-server";

  private process: ChildProcess | null = null;
  private port: number | null = null;
  private baseUrl: string | null = null;
  private ctx: RendererContext | null = null;
  private healthy = false;
  private inspectorProxy: InspectorProxy | null = null;

  get inspectorProxyUrl(): string | null {
    return this.inspectorProxy?.getProxyUrl() ?? null;
  }

  async startup(ctx: RendererContext): Promise<void> {
    this.ctx = ctx;

    // Validate node_modules exists
    const nodeModules = join(ctx.worktreePath, "node_modules");
    if (!existsSync(nodeModules)) {
      throw new Error(
        `node_modules not found at ${nodeModules}. ` +
        "Run the project's package manager install first.",
      );
    }

    this.port = await findAvailablePort(DEV_SERVER_PORT_MIN, DEV_SERVER_PORT_MAX);

    const MAX_PORT_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
      if (attempt > 0) {
        this.port = await findAvailablePort(this.port! + 1, DEV_SERVER_PORT_MAX);
      }

      const { command, args } = this.getDevCommand(ctx);

      this.process = spawn(command, args, {
        cwd: ctx.worktreePath,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(this.port),
        },
        shell: IS_WINDOWS,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Consume stdout/stderr to prevent buffer blocking
      this.process.stdout?.resume();
      this.process.stderr?.resume();

      this.baseUrl = `http://127.0.0.1:${this.port}`;

      try {
        await this.waitForReady(ctx.config.devServerTimeoutMs);

        this.inspectorProxy = new InspectorProxy();
        await this.inspectorProxy.startup(this.baseUrl!);

        this.healthy = true;
        return;
      } catch (err) {
        try { this.process.kill("SIGKILL"); } catch { /* already dead */ }
        this.process = null;

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
      throw new Error("Next.js renderer not started. Call startup() first.");
    }

    let url: string;
    if (mode === "route" && targetFile.startsWith("/")) {
      url = `${this.baseUrl}${targetFile}`;
    } else {
      const routePath = this.fileToRoute(targetFile);
      url = `${this.baseUrl}${routePath}`;
    }

    const proxyBase = this.inspectorProxyUrl;
    const proxyUrl = proxyBase
      ? url.replace(this.baseUrl!, proxyBase)
      : url;

    return { proxyUrl };
  }

  async rerender(targetFile: string, _changedCode: string): Promise<RendererOutput> {
    // Next.js has Fast Refresh — changes auto-propagate
    return this.render(targetFile, "page");
  }

  isHealthy(): boolean {
    return this.healthy && this.process !== null && this.process.exitCode === null;
  }

  async shutdown(): Promise<void> {
    this.healthy = false;

    if (this.inspectorProxy) {
      try { await this.inspectorProxy.shutdown(); } catch { /* ignore */ }
      this.inspectorProxy = null;
    }

    if (this.process) {
      try {
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

    // Use turbopack if the project is configured for it
    const useTurbopack = ctx.framework.buildTool === "custom";
    const args = ["next", "dev", "--port", String(this.port)];
    if (useTurbopack) {
      args.push("--turbopack");
    }

    return { command: npmCmd, args };
  }

  /**
   * Convert a Next.js file path to a route.
   *
   * App Router: app/dashboard/page.tsx → /dashboard
   * Pages Router: pages/about.tsx → /about
   */
  private fileToRoute(targetFile: string): string {
    let route = targetFile;

    // App Router: app/**/page.tsx → route
    const appMatch = route.match(/^(?:src\/)?app\/(.*)\/page\.[jt]sx?$/);
    if (appMatch) {
      route = "/" + appMatch[1];
      // Remove route groups like (marketing)
      route = route.replace(/\/\([^)]+\)/g, "");
      // Handle root page
      if (route === "/") return "/";
      return route.replace(/\/$/, "");
    }

    // App Router: app/page.tsx (root)
    if (/^(?:src\/)?app\/page\.[jt]sx?$/.test(route)) {
      return "/";
    }

    // Pages Router: pages/about.tsx → /about
    const pagesMatch = route.match(/^(?:src\/)?pages\/(.+)\.[jt]sx?$/);
    if (pagesMatch) {
      route = "/" + pagesMatch[1];
      route = route.replace(/\/index$/, "/");
      return route;
    }

    // Layout files — show root
    if (/layout\.[jt]sx?$/.test(route)) {
      return "/";
    }

    // Fallback — show root
    return "/";
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(this.baseUrl!, { signal: AbortSignal.timeout(2000) });
        if (response.ok || response.status === 404) {
          return;
        }
      } catch {
        // Not ready yet
      }

      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
        throw new Error(`Next.js dev server exited with code ${this.process.exitCode}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    throw new Error(`Next.js dev server did not start within ${timeoutMs}ms`);
  }
}
