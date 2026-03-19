import { ipcMain, app, BrowserWindow } from "electron";
import type { IpcHandlerContext } from "./ipc-handlers";
import { hideOverlay } from "./mini-overlay-window";
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
  // mini-overlay:dismiss
  // Renderer requests the overlay to be hidden without returning focus to the
  // previously active application. Used by the "Close" button in the done phase.
  // --------------------------------------------------------------------------
  ipcMain.on("mini-overlay:dismiss", () => {
    debugLog("[MiniOverlay IPC] Received dismiss request (no focus return)");
    hideOverlay();
  });

  // NOTE: mini-overlay:message-sent and mini-overlay:compose-ready are handled
  // by ipc-overlay-session-handlers.ts which correctly targets the main window
  // (not broadcast to all windows) and handles compose-mode show/focus.

  G.__miniOverlayIpcRegistered = true;
  debugLog("[MiniOverlay IPC] Handlers registered");
}
