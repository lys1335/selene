/**
 * Ghost OS IPC Handlers
 *
 * Electron main-process handlers for Ghost OS status, setup, and
 * vision model management. Follows the Parakeet handler pattern.
 *
 * IMPORTANT: These handlers are thin wrappers over lib/ghost-os/setup.ts.
 * All business logic (binary detection, permission parsing, version checks)
 * lives in the lib module — NOT duplicated here.
 */

import { ipcMain } from "electron";
import { execFile } from "child_process";
import type { IpcHandlerContext } from "./ipc-handlers";
import { debugLog, debugError } from "./debug-logger";
import {
  getGhostOsStatus,
  runGhostSetup,
  resolveGhostBinary,
  isVisionModelInstalled,
} from "@/lib/ghost-os/setup";
import { clearGhostOsConfigCache } from "@/lib/ghost-os/config";

/**
 * Safely send IPC event to renderer, checking if sender is still alive.
 */
function safeSend(
  sender: Electron.WebContents,
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, data);
  }
}

/**
 * Register Ghost OS IPC handlers.
 */
export function registerGhostOsHandlers(_ctx: IpcHandlerContext): void {
  // -------------------------------------------------------------------------
  // ghostos:getStatus — Check installation, version, permissions
  // Delegates entirely to lib/ghost-os/setup.ts — no duplicated logic.
  // -------------------------------------------------------------------------
  ipcMain.handle("ghostos:getStatus", async () => {
    debugLog("[GhostOS] Checking status...");
    try {
      const status = await getGhostOsStatus();
      debugLog(
        `[GhostOS] Status: installed=${status.installed}, version=${status.version}, vision=${status.visionModelInstalled}`,
      );
      return status;
    } catch (error) {
      debugError("[GhostOS] Status check failed:", error);
      return {
        installed: false,
        visionModelInstalled: false,
        permissions: {
          accessibility: false,
          screenRecording: false,
          inputMonitoring: false,
        },
      };
    }
  });

  // -------------------------------------------------------------------------
  // ghostos:runSetup — Run ghost setup command
  // Delegates to lib/ghost-os/setup.ts
  // -------------------------------------------------------------------------
  ipcMain.handle("ghostos:runSetup", async () => {
    debugLog("[GhostOS] Running setup...");
    const result = await runGhostSetup();
    // Clear cached config so MCP pipeline re-detects after setup
    clearGhostOsConfigCache();
    if (result.success) {
      debugLog("[GhostOS] Setup completed successfully");
    } else {
      debugError("[GhostOS] Setup failed:", result.stderr);
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // ghostos:downloadVisionModel — Download ShowUI-2B vision model
  // The only handler with local logic (streaming progress from child process).
  // -------------------------------------------------------------------------
  ipcMain.handle("ghostos:downloadVisionModel", async (event) => {
    debugLog("[GhostOS] Starting vision model download...");

    try {
      const binaryPath = await resolveGhostBinary();
      if (!binaryPath) {
        return {
          success: false,
          error: "Ghost OS binary not found",
        };
      }

      // Emit initial progress
      safeSend(event.sender, "model:downloadProgress", {
        modelId: "ghostos-showui-2b",
        status: "downloading",
        progress: 0,
        file: "ShowUI-2B",
      });

      const child = execFile(binaryPath, ["setup", "--vision"], {
        timeout: 600000, // 10 minutes for large model download
        env: {
          ...process.env,
          PATH: [
            process.env.PATH || "",
            "/opt/homebrew/bin",
            "/usr/local/bin",
          ].join(":"),
        },
      });

      // Stream stdout for progress indication
      if (child.stdout) {
        child.stdout.on("data", (data: Buffer | string) => {
          const text = data.toString();
          const progressMatch = text.match(/(\d+)%/);
          if (progressMatch) {
            const progress = parseInt(progressMatch[1], 10);
            safeSend(event.sender, "model:downloadProgress", {
              modelId: "ghostos-showui-2b",
              status: "downloading",
              progress,
              file: "ShowUI-2B",
            });
          }
        });
      }

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ghost setup --vision exited with code ${code}`));
        });
        child.on("error", reject);
      });

      // Verify vision model actually got installed (handles ghost setup --vision
      // silently no-oping on older Ghost OS versions)
      const visionInstalled = isVisionModelInstalled();
      if (!visionInstalled) {
        const errorMsg =
          "ghost setup --vision completed but vision model not found. " +
          "Your Ghost OS version may not support --vision. " +
          "Try running: ghost download-vision-model";
        debugError("[GhostOS]", errorMsg);
        safeSend(event.sender, "model:downloadProgress", {
          modelId: "ghostos-showui-2b",
          status: "error",
          progress: 0,
          error: errorMsg,
        });
        return { success: false, error: errorMsg };
      }

      safeSend(event.sender, "model:downloadProgress", {
        modelId: "ghostos-showui-2b",
        status: "completed",
        progress: 100,
        file: "ShowUI-2B",
      });

      debugLog("[GhostOS] Vision model download completed");
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      debugError("[GhostOS] Vision model download failed:", errorMsg);

      safeSend(event.sender, "model:downloadProgress", {
        modelId: "ghostos-showui-2b",
        status: "error",
        progress: 0,
        error: errorMsg,
      });

      return { success: false, error: errorMsg };
    }
  });
}
