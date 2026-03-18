import { ipcMain, app, BrowserWindow } from "electron";
import type { IpcHandlerContext } from "./ipc-handlers";
import { hideOverlay, getOverlay } from "./mini-overlay-window";
import { debugLog } from "./debug-logger";

// ---------------------------------------------------------------------------
// Guard — globalThis for hot-reload safety (module-level `let` resets on
// hot reload but ipcMain retains the old handlers, causing "already
// registered" errors).
// ---------------------------------------------------------------------------

const G = globalThis as typeof globalThis & {
  __miniOverlayIpcRegistered?: boolean;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register IPC handlers that serve the mini overlay renderer.
 * Safe to call multiple times — handlers are only registered once.
 */
export function registerMiniOverlayHandlers(_ctx: IpcHandlerContext): void {
  if (G.__miniOverlayIpcRegistered) {
    debugLog("[MiniOverlay IPC] Handlers already registered, skipping");
    return;
  }

  // --------------------------------------------------------------------------
  // mini-overlay:close
  // Renderer requests the overlay to be hidden (not destroyed).
  // --------------------------------------------------------------------------
  ipcMain.on("mini-overlay:close", () => {
    debugLog("[MiniOverlay IPC] Received close request");
    hideOverlay();
  });

  // --------------------------------------------------------------------------
  // mini-overlay:phase-update
  // Renderer reports the current recording / processing phase for diagnostics.
  // --------------------------------------------------------------------------
  ipcMain.on("mini-overlay:phase-update", (_event, phase: unknown) => {
    debugLog("[MiniOverlay IPC] Phase update:", phase);
  });

  // --------------------------------------------------------------------------
  // mini-overlay:request-focus-return
  // Renderer requests that focus be returned to the previously active app.
  // On macOS: hide the overlay first, then app.hide() to defocus entirely.
  // On Windows/Linux: minimize all Electron windows to return focus.
  // --------------------------------------------------------------------------
  ipcMain.handle("mini-overlay:request-focus-return", () => {
    debugLog("[MiniOverlay IPC] Focus return requested");

    // Always hide the overlay first — app.hide() on macOS hides ALL windows,
    // so the overlay must be explicitly hidden before we defocus the app.
    hideOverlay();

    if (process.platform === "darwin") {
      app.hide();
    } else {
      // Windows / Linux: minimize all visible BrowserWindows
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.isVisible()) {
          win.minimize();
        }
      }
    }

    return { success: true };
  });

  // --------------------------------------------------------------------------
  // mini-overlay:message-sent
  // Renderer reports that a chat message was successfully POSTed.
  // Forward to all other BrowserWindows (excluding the overlay itself) as
  // `overlay:session-updated` so the main app's OverlaySyncBridge can react.
  // --------------------------------------------------------------------------
  ipcMain.on(
    "mini-overlay:message-sent",
    (_event, payload: { sessionId: string; characterId: string }) => {
      debugLog("[MiniOverlay IPC] Message sent, forwarding session update:", payload);

      const overlayWin = getOverlay();
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        if (overlayWin && win.id === overlayWin.id) continue;
        win.webContents.send("overlay:session-updated", payload);
      }
    }
  );

  // --------------------------------------------------------------------------
  // mini-overlay:compose-ready
  // Renderer signals that a compose payload (transcript + screenshot) is ready
  // to be injected into the main app's composer.
  // Forward to all other BrowserWindows (excluding the overlay itself) as
  // `overlay:compose-inject` so the main app's OverlaySyncBridge can inject.
  // --------------------------------------------------------------------------
  ipcMain.handle(
    "mini-overlay:compose-ready",
    (
      _event,
      payload: {
        transcript: string;
        screenshotUrl: string;
        characterId: string;
        sessionId: string;
      }
    ) => {
      debugLog("[MiniOverlay IPC] Compose ready, forwarding inject payload:", payload);

      const overlayWin = getOverlay();
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        if (overlayWin && win.id === overlayWin.id) continue;
        win.webContents.send("overlay:compose-inject", payload);
      }

      return { success: true };
    }
  );

  G.__miniOverlayIpcRegistered = true;
  debugLog("[MiniOverlay IPC] Handlers registered");
}
