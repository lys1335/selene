import { BrowserWindow, screen } from "electron";
import { debugLog, debugError } from "./debug-logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShowOverlayOptions {
  /** Base URL of the embedded Next.js server (e.g. "http://localhost:3000"). */
  baseUrl: string;
  /** Absolute path to the preload script. */
  preloadPath: string;
  sessionId?: string;
  characterId?: string;
  screenshotUrl?: string;
}

// ---------------------------------------------------------------------------
// Singleton state (globalThis for hot-reload safety)
// ---------------------------------------------------------------------------

const G = globalThis as typeof globalThis & {
  __miniOverlayWindow?: BrowserWindow | null;
  __miniOverlayLoadPromise?: Promise<void> | null;
};

function getOverlayWindow(): BrowserWindow | null {
  return G.__miniOverlayWindow && !G.__miniOverlayWindow.isDestroyed()
    ? G.__miniOverlayWindow
    : null;
}

function setOverlayWindow(win: BrowserWindow | null): void {
  G.__miniOverlayWindow = win;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_SCREENSHOT_SCHEMES = ["local-media:", "http:", "https:", "/api/"];

function buildOverlayUrl(opts: ShowOverlayOptions): string {
  // Use URL constructor to handle trailing slashes correctly
  const base = new URL("/mini-overlay", opts.baseUrl);
  if (opts.sessionId) base.searchParams.set("sessionId", opts.sessionId);
  if (opts.characterId) base.searchParams.set("characterId", opts.characterId);
  // Validate screenshotUrl before passing to renderer
  if (opts.screenshotUrl) {
    const isAllowed = ALLOWED_SCREENSHOT_SCHEMES.some((scheme) =>
      opts.screenshotUrl!.startsWith(scheme)
    );
    if (isAllowed) {
      base.searchParams.set("screenshotUrl", opts.screenshotUrl);
    } else {
      debugError("[MiniOverlay] Rejected screenshotUrl with disallowed scheme:", opts.screenshotUrl);
    }
  }
  return base.toString();
}

function createOverlayWindow(opts: ShowOverlayOptions): BrowserWindow {
  const isMac = process.platform === "darwin";

  const win = new BrowserWindow({
    width: 480,
    height: 160,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    // macOS: use "panel" for floating behavior
    ...(isMac
      ? {
          type: "panel" as const,
          hasShadow: true,
        }
      : {}),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Position: top center of the primary display, 80 px from the top edge
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - 480) / 2);
  const y = workArea.y + 80;
  win.setPosition(x, y);

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
    debugLog("[MiniOverlay] Window ready-to-show — shown and focused");
  });

  win.on("closed", () => {
    debugLog("[MiniOverlay] Window closed");
    setOverlayWindow(null);
  });

  return win;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the mini overlay window.  Creates the BrowserWindow on the first call
 * and reuses it on subsequent calls.  Always loads the current URL so that
 * session / character / screenshot params are up to date.
 *
 * Serialized: if a load is already in progress, the second call waits for
 * it to complete rather than clobbering the first load.
 */
export async function showOverlay(opts: ShowOverlayOptions): Promise<void> {
  // Serialize concurrent calls — second hotkey press during load waits
  if (G.__miniOverlayLoadPromise) {
    return G.__miniOverlayLoadPromise;
  }

  G.__miniOverlayLoadPromise = (async () => {
    try {
      let win = getOverlayWindow();
      const isReused = !!win;
      if (!win) {
        debugLog("[MiniOverlay] Creating new overlay window");
        win = createOverlayWindow(opts);
        setOverlayWindow(win);
      } else {
        debugLog("[MiniOverlay] Reusing existing overlay window");
      }

      const url = buildOverlayUrl(opts);
      debugLog("[MiniOverlay] Loading URL:", url);
      await win.loadURL(url);

      // For reused windows, ready-to-show does not fire again after loadURL —
      // explicitly show and focus to ensure the hidden window becomes visible.
      if (isReused && !win.isDestroyed()) {
        win.show();
        win.focus();
        debugLog("[MiniOverlay] Reused window shown and focused after loadURL");
      }
    } catch (err) {
      debugError("[MiniOverlay] Failed to show overlay:", err);
      throw err;
    }
  })().finally(() => {
    G.__miniOverlayLoadPromise = null;
  });

  return G.__miniOverlayLoadPromise;
}

/**
 * Hide the overlay without destroying it so it can be shown again quickly.
 */
export function hideOverlay(): void {
  const win = getOverlayWindow();
  if (!win) return;
  win.hide();
  debugLog("[MiniOverlay] Window hidden");
}

/**
 * Return the current BrowserWindow instance, or null if it does not exist.
 */
export function getOverlay(): BrowserWindow | null {
  return getOverlayWindow();
}

/**
 * Destroy the overlay window and release all associated resources.
 */
export function destroyMiniOverlay(): void {
  const win = G.__miniOverlayWindow;
  if (!win || win.isDestroyed()) {
    setOverlayWindow(null);
    return;
  }
  try {
    win.destroy();
    debugLog("[MiniOverlay] Window destroyed");
  } catch (err) {
    debugError("[MiniOverlay] Error destroying overlay:", err);
  } finally {
    setOverlayWindow(null);
  }
}
