import * as path from "path";
import * as fs from "fs";
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

/**
 * Resolve the tray icon image for the current platform.
 * Checks multiple candidate locations for both dev and packaged builds.
 */
function resolveTrayIconImage(isMac: boolean): Electron.NativeImage | null {
  const platformIconName = isMac ? "tray-iconTemplate.png" : "tray-icon.png";

  // Candidate directories to search (in priority order)
  const candidateDirs = app.isPackaged
    ? [
        process.resourcesPath,                                    // extraResources root (icon.ico / icon.png land here)
        path.join(process.resourcesPath, "resources"),            // legacy resources/ subfolder
      ]
    : [
        path.join(process.cwd(), "build-resources"),              // dev: project build-resources/
        path.join(__dirname, "..", "resources"),                   // dev: legacy resources/
        path.join(process.cwd(), "resources"),                    // dev: project resources/
      ];

  // 1. Try platform-specific tray icon in each directory
  for (const dir of candidateDirs) {
    const iconPath = path.join(dir, platformIconName);
    if (!fs.existsSync(iconPath)) continue;
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        debugLog(`[Tray] Loaded platform icon: ${iconPath}`);
        return img;
      }
    } catch (err) {
      debugError(`[Tray] Failed to load platform icon ${iconPath}:`, err);
    }
  }

  // 2. Try icon.ico (Windows) then icon.png as fallback, resized to 22×22
  const fallbackNames = process.platform === "win32"
    ? ["icon.ico", "icon.png"]
    : ["icon.png"];

  for (const dir of candidateDirs) {
    for (const name of fallbackNames) {
      const iconPath = path.join(dir, name);
      if (!fs.existsSync(iconPath)) continue;
      try {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) {
          const resized = img.resize({ width: 22, height: 22 });
          debugLog(`[Tray] Loaded fallback icon (resized): ${iconPath}`);
          return resized;
        }
      } catch (err) {
        debugError(`[Tray] Failed to load fallback icon ${iconPath}:`, err);
      }
    }
  }

  return null;
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

  // -------------------------------------------------------------------------
  // Resolve icon image
  // -------------------------------------------------------------------------

  let iconImage = resolveTrayIconImage(isMac);

  // Last resort: empty image (tray will still function, just invisible)
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
