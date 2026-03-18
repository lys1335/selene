import { ipcMain } from "electron";
import { getMainWindow } from "./window-manager";
import { debugLog } from "./debug-logger";

// ---------------------------------------------------------------------------
// Guard — prevent double-registration on hot reload
// ---------------------------------------------------------------------------

const G = globalThis as typeof globalThis & {
  __overlaySessionIpcRegistered?: boolean;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register IPC handlers that forward overlay events to the main window and
 * handle compose-mode injection. Safe to call multiple times.
 */
export function registerOverlaySessionHandlers(): void {
  if (G.__overlaySessionIpcRegistered) {
    debugLog("[OverlaySession IPC] Handlers already registered, skipping");
    return;
  }

  // --------------------------------------------------------------------------
  // mini-overlay:message-sent
  // Forwarded from overlay renderer after a successful direct-mode chat POST.
  // The main window listens for "overlay:session-updated" to refresh its view.
  // --------------------------------------------------------------------------
  ipcMain.on("mini-overlay:message-sent", (_event, payload) => {
    debugLog("[OverlaySession IPC] message-sent received, forwarding to main window:", payload);
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send("overlay:session-updated", payload);
    }
  });

  // --------------------------------------------------------------------------
  // mini-overlay:compose-ready
  // Compose mode: show the main window and inject transcript into the composer.
  // --------------------------------------------------------------------------
  ipcMain.handle("mini-overlay:compose-ready", async (_event, payload) => {
    debugLog("[OverlaySession IPC] compose-ready received:", payload);

    // Import here to avoid circular deps at module load time
    const { showAndFocusMainWindow } = await import("./window-manager");

    await showAndFocusMainWindow();

    const mw = getMainWindow();
    // Small delay to let navigation settle before injecting
    await new Promise<void>((r) => setTimeout(r, 400));
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send("overlay:compose-inject", payload);
    }

    // Do NOT hide the overlay here — the overlay controls its own lifecycle.
    // It will close itself after showing a brief "Done" confirmation.
    return { success: true };
  });

  G.__overlaySessionIpcRegistered = true;
  debugLog("[OverlaySession IPC] Handlers registered");
}
