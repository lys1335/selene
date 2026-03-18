import * as path from "path";
import { Tray, Menu, nativeImage, app } from "electron";
import { debugLog, debugError } from "./debug-logger";

// ---------------------------------------------------------------------------
// Internal state (globalThis for hot-reload safety)
// ---------------------------------------------------------------------------

const G = globalThis as typeof globalThis & {
  __selineTray?: Tray | null;
};

function getTrayInstance(): Tray | null {
  return G.__selineTray && !G.__selineTray.isDestroyed() ? G.__selineTray : null;
}

function setTrayInstance(t: Tray | null): void {
  G.__selineTray = t;
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

function getResourcesPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "resources");
  }
  return path.join(__dirname, "..", "resources");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InitTrayOptions {
  onShowMainWindow: () => void;
  onQuit: () => void;
}

/**
 * Create and configure the system tray icon.  Should be called once after
 * app.whenReady() resolves.  Returns the Tray instance on success, or null
 * if tray creation fails (non-fatal — the app continues without a tray icon).
 */
export function initTray(opts: InitTrayOptions): Tray | null {
  const existing = getTrayInstance();
  if (existing) {
    debugLog("[Tray] Already initialized, skipping");
    return existing;
  }

  const isMac = process.platform === "darwin";
  const resourcesPath = getResourcesPath();

  // -------------------------------------------------------------------------
  // Resolve icon image
  // -------------------------------------------------------------------------

  let iconImage: Electron.NativeImage | null = null;

  // 1. Platform-specific tray icon
  const platformIconName = isMac ? "tray-iconTemplate.png" : "tray-icon.png";
  const platformIconPath = path.join(resourcesPath, platformIconName);

  try {
    const candidate = nativeImage.createFromPath(platformIconPath);
    if (!candidate.isEmpty()) {
      iconImage = candidate;
      debugLog(`[Tray] Loaded platform icon: ${platformIconPath}`);
    }
  } catch (err) {
    debugError("[Tray] Failed to load platform icon:", err);
  }

  // 2. Fallback: resize icon.png to 22×22
  if (!iconImage) {
    const fallbackPath = path.join(resourcesPath, "icon.png");
    try {
      const fallback = nativeImage.createFromPath(fallbackPath);
      if (!fallback.isEmpty()) {
        iconImage = fallback.resize({ width: 22, height: 22 });
        debugLog(`[Tray] Loaded fallback icon (resized): ${fallbackPath}`);
      }
    } catch (err) {
      debugError("[Tray] Failed to load fallback icon:", err);
    }
  }

  // 3. Last resort: empty image (tray will still function, just invisible)
  if (!iconImage) {
    debugLog("[Tray] Using empty icon as last resort");
    iconImage = nativeImage.createEmpty();
  }

  // On macOS, mark as template image so the system handles dark/light mode
  if (isMac) {
    iconImage.setTemplateImage(true);
  }

  // -------------------------------------------------------------------------
  // Create the tray
  // -------------------------------------------------------------------------

  let newTray: Tray | null = null;
  try {
    newTray = new Tray(iconImage);
    newTray.setToolTip("Selene");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Selene",
        click: () => {
          debugLog("[Tray] 'Open Selene' clicked");
          opts.onShowMainWindow();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          debugLog("[Tray] 'Quit' clicked");
          opts.onQuit();
        },
      },
    ]);

    newTray.setContextMenu(contextMenu);

    // Single-click on tray icon also shows the main window (Windows / Linux).
    // On macOS this fires on left-click; right-click still opens the menu.
    newTray.on("click", () => {
      debugLog("[Tray] Tray icon clicked");
      opts.onShowMainWindow();
    });

    setTrayInstance(newTray);
    debugLog("[Tray] Tray initialized successfully");
  } catch (err) {
    debugError("[Tray] Failed to create tray:", err);
    newTray = null;
    setTrayInstance(null);
  }

  return newTray;
}

/**
 * Destroy the tray icon and release the native resource.
 */
export function destroyTray(): void {
  const t = G.__selineTray;
  if (!t) return;
  try {
    if (!t.isDestroyed()) {
      t.destroy();
    }
    debugLog("[Tray] Tray destroyed");
  } catch (err) {
    debugError("[Tray] Error destroying tray:", err);
  } finally {
    setTrayInstance(null);
  }
}

/**
 * Return the current Tray instance, or null if not yet initialized / already
 * destroyed.
 */
export function getTray(): Tray | null {
  return getTrayInstance();
}
