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

export async function emitCapturedScreen(ctx: IpcHandlerContext) {
  const win = ctx.mainWindow();

  // Pre-check: notify renderer about missing permission so it can show an
  // actionable prompt instead of a generic error toast.
  const permStatus = getScreenCapturePermissionStatus();
  if (permStatus !== "granted" && permStatus !== "not-determined") {
    if (win && !win.isDestroyed()) {
      win.webContents.send("permission:screen-required");
    }
    // Still go through the normal capture path so existing listeners receive
    // the result (with success=false) and can handle it.
  }

  // Snapshot focus state BEFORE the async capture — isFocused() sampled after
  // an await reflects post-capture state, not trigger-time state.
  const wasFocused = win && !win.isDestroyed() ? win.isFocused() : false;

  const result = await captureDisplay({ mediaDir: ctx.mediaDir });
  if (!win || win.isDestroyed()) {
    return result;
  }

  win.webContents.send("screen-capture:captured", result);
  if (result.success) {
    if (win.isMinimized()) {
      win.restore();
      win.focus();
    } else if (!win.isVisible()) {
      win.show();
      win.focus();
    } else if (wasFocused) {
      win.focus();
    }
    // If visible but not focused, user is in another app — don't steal focus
  }

  return result;
}

let screenCaptureHandlersRegistered = false;

export function registerScreenCaptureHandlers(ctx: IpcHandlerContext): void {
  if (screenCaptureHandlersRegistered) return;
  screenCaptureHandlersRegistered = true;

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
