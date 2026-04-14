/**
 * PHP Framework Renderer
 *
 * Handles PHP and Laravel projects by spawning PHP's built-in dev server.
 * For Laravel: `php artisan serve`
 * For plain PHP: `php -S 127.0.0.1:<port>`
 */

import type { FrameworkRenderer, RendererContext, RendererOutput } from "./types";
import type { FrameworkType } from "../project-detection";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import { join, relative } from "path";
import { InspectorProxy } from "./inspector-proxy";
import { findAvailablePort } from "./port-utils";

const IS_WINDOWS = process.platform === "win32";

export class PHPRenderer implements FrameworkRenderer {
  readonly frameworks: FrameworkType[] = ["php", "laravel"];
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
    this.port = await findAvailablePort(8100, 8200);

    const isLaravel = existsSync(join(ctx.worktreePath, "artisan"));

    // Retry with new ports on EADDRINUSE (W3 — port TOCTOU race)
    const MAX_PORT_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
      if (attempt > 0) {
        this.port = await findAvailablePort(this.port! + 1, 8200);
      }

      if (isLaravel) {
        this.process = spawn(
          IS_WINDOWS ? "php.exe" : "php",
          ["artisan", "serve", "--port=" + this.port, "--host=127.0.0.1"],
          {
            cwd: ctx.worktreePath,
            env: { ...process.env },
            shell: IS_WINDOWS,
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
      } else {
        // Determine document root: public/ if exists, otherwise project root
        const docRoot = existsSync(join(ctx.worktreePath, "public"))
          ? join(ctx.worktreePath, "public")
          : ctx.worktreePath;

        this.process = spawn(
          IS_WINDOWS ? "php.exe" : "php",
          ["-S", `127.0.0.1:${this.port}`, "-t", docRoot],
          {
            cwd: ctx.worktreePath,
            env: { ...process.env },
            shell: IS_WINDOWS,
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
      }

      // Consume stdout/stderr to prevent buffer blocking (W4)
      this.process.stdout?.resume();
      this.process.stderr?.resume();

      this.baseUrl = `http://127.0.0.1:${this.port}`;

      try {
        await this.waitForReady(ctx.config.devServerTimeoutMs);

        // Start inspector proxy targeting the PHP dev server
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
      throw new Error("PHP renderer not started. Call startup() first.");
    }

    let url: string;
    if (mode === "route" && targetFile.startsWith("/")) {
      url = `${this.baseUrl}${targetFile}`;
    } else {
      // For Laravel: blade templates map to routes differently
      // For plain PHP: use file path directly
      const isLaravel = this.ctx && existsSync(join(this.ctx.worktreePath, "artisan"));
      if (isLaravel) {
        url = `${this.baseUrl}/${this.bladeToRoute(targetFile)}`;
      } else {
        url = `${this.baseUrl}/${targetFile}`;
      }
    }

    // Return the inspector proxy URL so the preview iframe loads through
    // the proxy (which injects the inspector script into HTML responses).
    const proxyBase = this.inspectorProxyUrl;
    const proxyUrl = proxyBase
      ? url.replace(this.baseUrl!, proxyBase)
      : url;

    return {
      proxyUrl: proxyUrl,
    };
  }

  async rerender(targetFile: string, changedCode: string): Promise<RendererOutput> {
    // PHP is interpreted — changes take effect immediately on next request
    // Write the changed code to the file
    if (this.ctx) {
      const fullPath = join(this.ctx.worktreePath, targetFile);
      await fs.writeFile(fullPath, changedCode, "utf-8");
    }
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
        this.process.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            try { this.process?.kill("SIGKILL"); } catch { /* ignore */ }
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

  private bladeToRoute(targetFile: string): string {
    // resources/views/welcome.blade.php → /
    // resources/views/dashboard.blade.php → /dashboard
    return targetFile
      .replace(/^resources\/views\//, "")
      .replace(/\.blade\.php$/, "")
      .replace(/\/index$/, "/")
      .replace(/^welcome$/, "");
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(this.baseUrl!, { signal: AbortSignal.timeout(2000) });
        if (response.ok || response.status === 404 || response.status === 500) {
          return; // Server is responding
        }
      } catch {
        // Not ready yet
      }

      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
        throw new Error(`PHP server exited with code ${this.process.exitCode}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    throw new Error(`PHP server did not start within ${timeoutMs}ms`);
  }
}

// Port allocation uses shared utility from ./port-utils.ts
