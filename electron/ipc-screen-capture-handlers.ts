import { ipcMain } from "electron";
import type { IpcHandlerContext } from "./ipc-handlers";
import {
  captureDisplay,
  getScreenCapturePermissionStatus,
} from "./screen-capture";
import {
  clearScreenCaptureHotkey,
  getRegisteredScreenCaptureHotkey,
  registerScreenCaptureHotkey,
  registerScreenCaptureHotkeyFromSettings,
} from "./hotkey-manager";

function normalizeAccelerator(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeEnabled(value: unknown): boolean {
  return value !== false;
}

async function emitCapturedScreen(ctx: IpcHandlerContext) {
  const result = await captureDisplay({ mediaDir: ctx.mediaDir });
  const win = ctx.mainWindow();
  if (!win || win.isDestroyed()) {
    return result;
  }

  win.webContents.send("screen-capture:captured", result);
  if (result.success) {
    if (win.isMinimized()) {
      win.restore();
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.focus();
  }

  return result;
}

export function registerScreenCaptureHandlers(ctx: IpcHandlerContext): void {
  ipcMain.handle("screen-capture:capture", async () => {
    return captureDisplay({ mediaDir: ctx.mediaDir });
  });

  ipcMain.handle("screen-capture:register", (_event, accelerator?: unknown, enabled?: unknown) => {
    const input = normalizeAccelerator(accelerator);
    return registerScreenCaptureHotkey({
      accelerator: input || getRegisteredScreenCaptureHotkey(),
      enabled: normalizeEnabled(enabled),
      onTrigger: () => {
        void emitCapturedScreen(ctx);
      },
    });
  });

  ipcMain.handle("screen-capture:registerFromSettings", () => {
    return registerScreenCaptureHotkeyFromSettings({
      dataDir: ctx.dataDir,
      onTrigger: () => {
        void emitCapturedScreen(ctx);
      },
    });
  });

  ipcMain.handle("screen-capture:getRegistered", () => {
    return {
      accelerator: getRegisteredScreenCaptureHotkey(),
    };
  });

  ipcMain.handle("screen-capture:clear", () => {
    clearScreenCaptureHotkey();
    return { success: true };
  });

  ipcMain.handle("screen-capture:check-permission", () => {
    return {
      status: getScreenCapturePermissionStatus(),
    };
  });
}
