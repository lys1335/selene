import { ipcMain, screen } from "electron";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { IpcHandlerContext } from "./ipc-handlers";
import { captureDisplay, getScreenCapturePermissionStatus, type ScreenCapturePermissionStatus } from "./screen-capture";
import { collectMetadata, type ScreenCaptureMetadata } from "./metadata-collector";
import {
  registerUnifiedCaptureHotkey,
  registerUnifiedCaptureHotkeyFromSettings,
  getRegisteredUnifiedCaptureHotkey,
  clearUnifiedCaptureHotkey,
} from "./hotkey-manager";
import { getOverlay, showOverlay } from "./mini-overlay-window";
import { debugLog, debugError } from "./debug-logger";
import { UNIFIED_CAPTURE_DEBOUNCE_MARKER } from "../lib/electron/types";
import { loadSettings } from "../lib/settings/settings-manager";

export interface UnifiedCaptureTriggerPayload {
  mode: "voice+screen" | "voice-only" | "screen-only";
  screenshot?: {
    url: string;
    filePath: string;
  };
  metadata?: ScreenCaptureMetadata;
  startVoice: boolean;
  screenshotError?: string;
  /** Permission status at capture time — allows renderer to show actionable prompts. */
  permissionStatus?: ScreenCapturePermissionStatus;
  traceId: string;
}

// Debounce: prevent rapid successive triggers
let lastTriggerTime = 0;
const DEBOUNCE_MS = 500;

// Guard against double-registration on dev hot-reload
let handlersRegistered = false;

async function executeUnifiedCapture(
  ctx: IpcHandlerContext,
  mode: "voice+screen" | "voice-only" | "screen-only"
): Promise<UnifiedCaptureTriggerPayload> {
  const traceId = randomUUID().slice(0, 8);
  const now = Date.now();

  if (now - lastTriggerTime < DEBOUNCE_MS) {
    debugLog(`[UnifiedCapture:${traceId}] Debounced (${now - lastTriggerTime}ms since last)`);
    return {
      mode,
      startVoice: false,
      traceId,
      screenshotError: UNIFIED_CAPTURE_DEBOUNCE_MARKER,
    };
  }
  lastTriggerTime = now;

  // Snapshot focus state BEFORE any async work so we know whether Selene was
  // the active window at trigger time, not after the capture completes.
  const captureWin = ctx.mainWindow();
  const wasFocusedAtTrigger = captureWin && !captureWin.isDestroyed() ? captureWin.isFocused() : false;

  // Check app exclusion list
  const settings = loadSettings();
  const excludedApps = (settings.screenCaptureExcludedApps ?? "")
    .split(",")
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);

  if (excludedApps.length > 0 && (mode === "voice+screen" || mode === "screen-only")) {
    try {
      const meta = await collectMetadata({ displayIndex: 0, resolution: { width: 0, height: 0 } });
      if (meta.activeAppName) {
        const appName = meta.activeAppName.toLowerCase();
        const isExcluded = excludedApps.some((excluded: string) => appName.includes(excluded) || excluded.includes(appName));
        if (isExcluded) {
          debugLog(`[UnifiedCapture:${traceId}] Blocked — excluded app: ${meta.activeAppName}`);
          return { mode, startVoice: false, traceId, screenshotError: `Screen capture blocked for: ${meta.activeAppName}` };
        }
      }
    } catch {
      // If metadata fails, proceed normally (don't block capture)
    }
  }

  debugLog(`[UnifiedCapture:${traceId}] Triggered mode=${mode}`);

  const payload: UnifiedCaptureTriggerPayload = {
    mode,
    startVoice: mode === "voice+screen" || mode === "voice-only",
    traceId,
  };

  // Step 1: Capture screen BEFORE bringing window forward
  if (mode === "voice+screen" || mode === "screen-only") {
    try {
      // Collect metadata in parallel with screen capture
      const cursorPoint = screen.getCursorScreenPoint();
      const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();

      const [captureResult, metadata] = await Promise.all([
        captureDisplay({ mediaDir: ctx.mediaDir }),
        collectMetadata({
          displayIndex: targetDisplay.id,
          resolution: {
            width: targetDisplay.bounds.width,
            height: targetDisplay.bounds.height,
          },
        }),
      ]);

      payload.permissionStatus = captureResult.permissionStatus;

      if (captureResult.success && captureResult.imageUrl) {
        payload.screenshot = {
          url: captureResult.imageUrl,
          filePath: captureResult.relativePath || "",
        };
        debugLog(`[UnifiedCapture:${traceId}] Screenshot captured: ${captureResult.imageUrl}`);
      } else {
        payload.screenshotError = captureResult.error || "Capture returned empty";
        debugLog(`[UnifiedCapture:${traceId}] Screenshot failed: ${payload.screenshotError}`);
      }

      payload.metadata = metadata;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      payload.screenshotError = message;
      debugError(`[UnifiedCapture:${traceId}] Capture error:`, error);
    }
  }

  // Step 2: Bring Selene window forward — but don't steal focus if user is
  // currently in another app (e.g. GhostOS automating a background workflow).
  const win = ctx.mainWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore();
      win.focus();
    } else if (!win.isVisible()) {
      win.show();
      win.focus();
    } else if (wasFocusedAtTrigger) {
      win.focus();
    }
  }

  // Step 3: Emit unified event to renderer
  if (win && !win.isDestroyed()) {
    win.webContents.send("unified-capture:triggered", payload);
    debugLog(`[UnifiedCapture:${traceId}] Event emitted to renderer`);
  }

  return payload;
}

/**
 * Creates a trigger callback for the unified capture hotkey.
 * Always routes to the mini overlay — captures screenshot first,
 * then opens the overlay with the screenshot URL.
 * If the overlay is already visible, sends a toggle-recording signal instead.
 */
export function createUnifiedCaptureTrigger(ctx: IpcHandlerContext): () => void {
  return () => {
    const baseUrl = ctx.isDev
      ? (process.env.ELECTRON_DEV_URL || `http://localhost:3000`)
      : `${ctx.prodUseHttps ? "https" : "http"}://localhost:${ctx.prodServerPort}`;

    const overlay = getOverlay();
    if (overlay && !overlay.isDestroyed() && overlay.isVisible() && !overlay.webContents.isCrashed()) {
      // Overlay already showing — toggle recording
      overlay.webContents.send("overlay:toggle-recording");
      return;
    }

    // Pre-check: if screen recording permission is missing, notify the
    // renderer so it can show an actionable prompt instead of silently
    // opening the overlay without a screenshot.
    const permStatus = getScreenCapturePermissionStatus();
    if (permStatus !== "granted" && permStatus !== "not-determined") {
      const win = ctx.mainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("permission:screen-required");
      }
      // Still open overlay for voice, just without a screenshot
      showOverlay({
        baseUrl,
        preloadPath: path.join(__dirname, "preload.js"),
        screenshotUrl: undefined,
      }).catch((err: unknown) => {
        debugError("[UnifiedCapture] Failed to show mini overlay:", err);
      });
      return;
    }

    // Capture screenshot BEFORE showing overlay so capture shows user's screen
    captureDisplay({ mediaDir: ctx.mediaDir })
      .then((captureResult) => {
        const screenshotUrl = captureResult.success ? captureResult.imageUrl : undefined;
        if (!captureResult.success) {
          debugLog("[UnifiedCapture] Screenshot capture failed, opening overlay without screenshot:", captureResult.error);
        }
        return showOverlay({
          baseUrl,
          preloadPath: path.join(__dirname, "preload.js"),
          screenshotUrl,
        });
      })
      .catch((err: unknown) => {
        debugError("[UnifiedCapture] Failed to show mini overlay:", err);
      });
  };
}

export function registerUnifiedCaptureHandlers(ctx: IpcHandlerContext): void {
  if (handlersRegistered) {
    debugLog("[UnifiedCapture] Handlers already registered — skipping duplicate registration");
    return;
  }
  handlersRegistered = true;

  // Manual trigger from renderer UI
  ipcMain.handle("unified-capture:trigger", async (_event, mode?: unknown) => {
    const captureMode = (typeof mode === "string" && ["voice+screen", "voice-only", "screen-only"].includes(mode))
      ? mode as "voice+screen" | "voice-only" | "screen-only"
      : "voice+screen";
    return executeUnifiedCapture(ctx, captureMode);
  });

  const triggerCallback = createUnifiedCaptureTrigger(ctx);

  // Register/update unified hotkey
  ipcMain.handle("unified-capture:register", (_event, accelerator?: unknown, enabled?: unknown) => {
    const input = typeof accelerator === "string" ? accelerator.trim() : "";
    return registerUnifiedCaptureHotkey({
      accelerator: input || getRegisteredUnifiedCaptureHotkey(),
      enabled: enabled !== false,
      onTrigger: triggerCallback,
    });
  });

  // Register from saved settings
  ipcMain.handle("unified-capture:registerFromSettings", () => {
    return registerUnifiedCaptureHotkeyFromSettings({
      dataDir: ctx.dataDir,
      onTrigger: triggerCallback,
    });
  });

  // Get currently registered accelerator
  ipcMain.handle("unified-capture:getRegistered", () => {
    return {
      accelerator: getRegisteredUnifiedCaptureHotkey(),
    };
  });

  // Clear unified hotkey
  ipcMain.handle("unified-capture:clear", () => {
    clearUnifiedCaptureHotkey();
    return { success: true };
  });
}
