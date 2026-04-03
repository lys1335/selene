import { ipcMain, systemPreferences, shell } from "electron";
import type { IpcHandlerContext } from "./ipc-context";
import type { PermissionStatus, PermissionCheckResult } from "../lib/electron/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapMediaAccessStatus(raw: string): PermissionStatus {
  switch (raw) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "restricted":
      return "restricted";
    case "not-determined":
      return "not-determined";
    default:
      return "not-determined";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronously returns the current screen-capture permission status without
 * prompting the user or triggering any system dialog.
 */
function getScreenPermissionStatus(): PermissionStatus {
  if (process.platform !== "darwin") {
    // Windows / Linux do not gate screen capture behind a permission prompt.
    return "granted";
  }
  const raw = systemPreferences.getMediaAccessStatus("screen");
  return mapMediaAccessStatus(raw);
}

/**
 * Checks screen, microphone, and accessibility permissions and returns their
 * current statuses.
 */
async function checkPermissions(): Promise<PermissionCheckResult> {
  if (process.platform === "darwin") {
    const screen = getScreenPermissionStatus();
    const micRaw = systemPreferences.getMediaAccessStatus("microphone");
    const microphone = mapMediaAccessStatus(micRaw);
    const accessibility: PermissionStatus = systemPreferences.isTrustedAccessibilityClient(false)
      ? "granted"
      : "not-determined";

    return { screen, microphone, accessibility };
  }

  if (process.platform === "win32") {
    // Windows grants screen and microphone access at the OS level; the app
    // does not surface a per-app permission UI analogous to macOS.
    return {
      screen: "granted",
      microphone: "granted",
      accessibility: "granted",
    };
  }

  // All other platforms (Linux, etc.) — report unavailable so callers can
  // skip permission flows entirely.
  return {
    screen: "unavailable",
    microphone: "unavailable",
    accessibility: "unavailable",
  };
}

/**
 * Opens System Preferences › Privacy › Screen Recording on macOS.
 * No-op on other platforms (screen capture is always permitted there).
 */
async function requestScreenPermission(): Promise<void> {
  if (process.platform !== "darwin") return;
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  );
}

/**
 * Requests microphone access via the native system prompt.
 * Returns true if access was granted, false otherwise.
 * On non-macOS platforms, returns true immediately.
 */
async function requestMicPermission(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  return systemPreferences.askForMediaAccess("microphone");
}

/**
 * Prompts the user to grant Accessibility access (required for certain
 * automation features).  On macOS this opens the Accessibility pane; on
 * Windows and other platforms it returns true immediately.
 */
async function requestAccessibilityPermission(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  // Passing `true` causes the system to show the Accessibility permission
  // prompt / open System Settings if the app is not yet trusted.
  return systemPreferences.isTrustedAccessibilityClient(true);
}

/**
 * Polls for screen-capture permission every 2 seconds, up to `timeoutMs`.
 * Calls `onGranted` as soon as the status transitions to "granted".
 * Returns a cleanup function that cancels the poll early if needed.
 */
function pollScreenPermission(
  onGranted: () => void,
  timeoutMs = 30_000,
): () => void {
  const INTERVAL_MS = 2_000;
  let stopped = false;

  const intervalId = setInterval(() => {
    if (stopped) return;
    if (getScreenPermissionStatus() === "granted") {
      stopped = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      onGranted();
    }
  }, INTERVAL_MS);

  const timeoutId = setTimeout(() => {
    if (stopped) return;
    stopped = true;
    clearInterval(intervalId);
  }, timeoutMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
    clearTimeout(timeoutId);
  };
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

// Use globalThis to survive hot reloads in development — same pattern as fileWatchers
const g = globalThis as unknown as { __permissionHandlersRegistered?: boolean };
if (!g.__permissionHandlersRegistered) g.__permissionHandlersRegistered = false;

export function registerPermissionHandlers(_ctx: IpcHandlerContext): void {
  if (g.__permissionHandlersRegistered) return;
  g.__permissionHandlersRegistered = true;

  ipcMain.handle("permission:check", async () => {
    return checkPermissions();
  });

  ipcMain.handle("permission:request-screen", async () => {
    await requestScreenPermission();
  });

  ipcMain.handle("permission:request-mic", async () => {
    return requestMicPermission();
  });

  ipcMain.handle("permission:request-accessibility", async () => {
    return requestAccessibilityPermission();
  });
}
