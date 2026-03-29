/**
 * Ghost OS IPC Handlers
 *
 * Electron main-process handlers for Ghost OS status, setup, and
 * vision model management. Follows the Parakeet handler pattern.
 */

import { ipcMain } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { IpcHandlerContext } from "./ipc-handlers";
import { debugLog, debugError } from "./debug-logger";

const execFileAsync = promisify(execFile);

/** Homebrew paths to search for ghost binary */
const HOMEBREW_PATHS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** Ghost OS home directory */
const GHOST_OS_HOME = path.join(os.homedir(), ".ghost-os");
const VISION_MODEL_DIR = path.join(GHOST_OS_HOME, "models", "ShowUI-2B");

/** Known sentinel files for a valid ShowUI-2B installation */
const VISION_SENTINEL_SUFFIXES = ["config.json", ".safetensors"];

/**
 * Resolve ghost binary from PATH or known locations.
 * Verifies the binary is actually Ghost OS (not Ghost CMS CLI).
 */
async function resolveGhostBinary(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["ghost"], {
      timeout: 5000,
      env: {
        ...process.env,
        PATH: [process.env.PATH || "", ...HOMEBREW_PATHS].join(":"),
      },
    });
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) {
      if (await verifyGhostOsBinary(resolved)) return resolved;
    }
  } catch {
    // which failed
  }

  for (const dir of HOMEBREW_PATHS) {
    const candidate = path.join(dir, "ghost");
    if (fs.existsSync(candidate)) {
      if (await verifyGhostOsBinary(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Verify a binary is Ghost OS, not Ghost CMS CLI or something else.
 */
async function verifyGhostOsBinary(binaryPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 3000,
    });
    const lower = stdout.toLowerCase();
    return (
      lower.includes("ghost-os") ||
      lower.includes("ghost os") ||
      lower.includes("axorcist")
    );
  } catch {
    return false;
  }
}

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
  // -------------------------------------------------------------------------
  ipcMain.handle("ghostos:getStatus", async () => {
    debugLog("[GhostOS] Checking status...");

    const binaryPath = await resolveGhostBinary();
    if (!binaryPath) {
      debugLog("[GhostOS] Binary not found");
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

    // Get version
    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      version = match ? match[1] : undefined;
    } catch {
      debugError("[GhostOS] Failed to get version");
    }

    // Check vision model — look for actual model files, not just any file
    let visionModelInstalled = false;
    try {
      if (fs.existsSync(VISION_MODEL_DIR)) {
        const files = fs.readdirSync(VISION_MODEL_DIR);
        visionModelInstalled = files.some((f) =>
          VISION_SENTINEL_SUFFIXES.some(
            (sentinel) => f === sentinel || f.endsWith(sentinel)
          )
        );
      }
    } catch {
      // ignore
    }

    // Run ghost doctor for permissions
    const permissions = {
      accessibility: false,
      screenRecording: false,
      inputMonitoring: false,
    };

    try {
      const { stdout } = await execFileAsync(binaryPath, ["doctor"], {
        timeout: 30000,
        env: {
          ...process.env,
          PATH: [process.env.PATH || "", ...HOMEBREW_PATHS].join(":"),
        },
      });

      const lines = stdout.split("\n");
      for (const line of lines) {
        const lower = line.toLowerCase();
        const passed = /[✓✅]/.test(line) || /\[pass\]/i.test(line);
        if (lower.includes("accessibility")) permissions.accessibility = passed;
        if (lower.includes("screen") && lower.includes("record")) permissions.screenRecording = passed;
        if (lower.includes("input") && lower.includes("monitor")) permissions.inputMonitoring = passed;
      }
    } catch (error) {
      debugError("[GhostOS] ghost doctor failed:", error);
    }

    debugLog(`[GhostOS] Status: installed=${!!binaryPath}, version=${version}, vision=${visionModelInstalled}`);

    return {
      installed: true,
      version,
      visionModelInstalled,
      permissions,
      binaryPath,
    };
  });

  // -------------------------------------------------------------------------
  // ghostos:runSetup — Run ghost setup command
  // -------------------------------------------------------------------------
  ipcMain.handle("ghostos:runSetup", async () => {
    debugLog("[GhostOS] Running setup...");

    const binaryPath = await resolveGhostBinary();
    if (!binaryPath) {
      return {
        success: false,
        stdout: "",
        stderr: "Ghost OS binary not found. Install via: brew install ghostwright/ghost-os/ghost-os",
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(binaryPath, ["setup"], {
        timeout: 120000,
        env: {
          ...process.env,
          PATH: [process.env.PATH || "", ...HOMEBREW_PATHS].join(":"),
        },
      });
      debugLog("[GhostOS] Setup completed successfully");
      return { success: true, stdout, stderr };
    } catch (error) {
      const errObj = error as { message?: string; stdout?: string; stderr?: string };
      const stderr = errObj.stderr || errObj.message || String(error);
      const stdout = errObj.stdout || "";
      debugError("[GhostOS] Setup failed:", stderr);
      return { success: false, stdout, stderr };
    }
  });

  // -------------------------------------------------------------------------
  // ghostos:downloadVisionModel — Download ShowUI-2B vision model
  // -------------------------------------------------------------------------
  ipcMain.handle("ghostos:downloadVisionModel", async (event) => {
    debugLog("[GhostOS] Starting vision model download...");

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

    try {
      // Use ghost setup with vision flag if available, otherwise just run setup
      const child = execFile(binaryPath, ["setup", "--vision"], {
        timeout: 600000, // 10 minutes for large model download
        env: {
          ...process.env,
          PATH: [process.env.PATH || "", ...HOMEBREW_PATHS].join(":"),
        },
      });

      // Stream stdout for progress indication
      let lastProgress = 0;
      if (child.stdout) {
        child.stdout.on("data", (data: Buffer | string) => {
          const text = data.toString();
          // Try to parse progress from output (percentage patterns)
          const progressMatch = text.match(/(\d+)%/);
          if (progressMatch) {
            lastProgress = parseInt(progressMatch[1], 10);
            safeSend(event.sender, "model:downloadProgress", {
              modelId: "ghostos-showui-2b",
              status: "downloading",
              progress: lastProgress,
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
