import * as path from "node:path";
import { ipcMain } from "electron";
import type { IpcHandlerContext } from "./ipc-context";
import {
  registerVoiceHotkey,
  registerVoiceHotkeyFromSettings,
  getRegisteredVoiceHotkey,
  clearVoiceHotkey,
} from "./hotkey-manager";
import { debugError } from "./debug-logger";
import { getOverlay, showOverlay } from "./mini-overlay-window";

function normalizeAccelerator(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function createVoiceOverlayTrigger(ctx: IpcHandlerContext): () => void {
  return () => {
    const baseUrl = ctx.isDev
      ? (process.env.ELECTRON_DEV_URL || "http://127.0.0.1:3000")
      : `${ctx.prodUseHttps ? "https" : "http"}://127.0.0.1:${ctx.prodServerPort}`;

    const overlay = getOverlay();
    if (overlay && !overlay.isDestroyed() && overlay.isVisible() && !overlay.webContents.isCrashed()) {
      overlay.webContents.send("overlay:toggle-recording");
      return;
    }

    void showOverlay({
      baseUrl,
      preloadPath: path.join(__dirname, "preload.js"),
    }).catch((error) => {
      debugError("[VoiceHotkey] Failed to show mini overlay:", error);
    });
  };
}

export function registerVoiceHotkeyHandlers(ctx: IpcHandlerContext): void {
  const triggerCallback = createVoiceOverlayTrigger(ctx);

  ipcMain.handle("voice-hotkey:register", (_event, accelerator?: unknown) => {
    const input = normalizeAccelerator(accelerator);
    const result = registerVoiceHotkey({
      accelerator: input || getRegisteredVoiceHotkey(),
      onTrigger: triggerCallback,
    });

    return result;
  });

  ipcMain.handle("voice-hotkey:registerFromSettings", () => {
    const result = registerVoiceHotkeyFromSettings({
      dataDir: ctx.dataDir,
      onTrigger: triggerCallback,
    });

    return result;
  });

  ipcMain.handle("voice-hotkey:getRegistered", () => {
    return {
      accelerator: getRegisteredVoiceHotkey(),
    };
  });

  ipcMain.handle("voice-hotkey:clear", () => {
    clearVoiceHotkey();
    return { success: true };
  });
}
