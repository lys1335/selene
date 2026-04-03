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
interface TrayIconResult {
  image: Electron.NativeImage;
  /** True when the image was loaded from a dedicated *Template icon file. */
  isTemplate: boolean;
}

function resolveTrayIconImage(isMac: boolean): TrayIconResult | null {
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
        return { image: img, isTemplate: isMac };
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
          // Fallback is a full-color app icon — NOT a template.
          // Setting setTemplateImage(true) on macOS would discard the color
          // data and render only the alpha channel, producing a ghost icon.
          return { image: resized, isTemplate: false };
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
  onVoiceSession: () => void;
  onVoiceScreenshot: () => void;
  onScreenshot: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
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

  const resolved = resolveTrayIconImage(isMac);

  let iconImage: Electron.NativeImage;
  if (resolved) {
    iconImage = resolved.image;
    // Only mark as template when we loaded an actual *Template.png file.
    // Fallback full-color icons must NOT be set as template on macOS —
    // macOS templates render alpha-only, which turns full-color icons into
    // invisible "ghost" icons in the menu bar.
    if (isMac && resolved.isTemplate) {
      iconImage.setTemplateImage(true);
    }
  } else {
    debugLog("[Tray] Using empty icon as last resort");
    iconImage = nativeImage.createEmpty();
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
        label: "Voice Session",
        click: () => {
          debugLog("[Tray] 'Voice Session' clicked");
          opts.onVoiceSession();
        },
      },
      {
        label: "Voice + Screenshot",
        click: () => {
          debugLog("[Tray] 'Voice + Screenshot' clicked");
          opts.onVoiceScreenshot();
        },
      },
      {
        label: "Take Screenshot",
        click: () => {
          debugLog("[Tray] 'Take Screenshot' clicked");
          opts.onScreenshot();
        },
      },
      { type: "separator" },
      {
        label: "New Chat",
        click: () => {
          debugLog("[Tray] 'New Chat' clicked");
          opts.onNewChat();
        },
      },
      {
        label: "Settings",
        click: () => {
          debugLog("[Tray] 'Settings' clicked");
          opts.onOpenSettings();
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
function getTray(): Tray | null {
  return getTrayInstance();
}
