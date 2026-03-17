import { exec } from "node:child_process";
import { debugError } from "./debug-logger";

export interface ScreenCaptureMetadata {
  capturedAt: string;
  activeWindowTitle?: string;
  activeAppName?: string;
  activeUrl?: string;
  displayIndex?: number;
  originalResolution?: { width: number; height: number };
  captureMode: "fullscreen" | "active-window" | "region" | "display";
}

function execPromise(command: string, timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function collectMacOSMetadata(): Promise<Partial<ScreenCaptureMetadata>> {
  const result: Partial<ScreenCaptureMetadata> = {};

  // Get active app name and window title via AppleScript
  try {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        try
          set winTitle to name of front window of frontApp
        on error
          set winTitle to ""
        end try
        return appName & "|||" & winTitle
      end tell
    `;
    const raw = await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const [appName, windowTitle] = raw.split("|||");
    if (appName) result.activeAppName = appName.trim();
    if (windowTitle) result.activeWindowTitle = windowTitle.trim();
  } catch (error) {
    debugError("[MetadataCollector] macOS AppleScript failed:", error);
  }

  // Try to get browser URL if the active app is a known browser
  if (result.activeAppName) {
    const browserName = result.activeAppName;
    const knownBrowsers = ["Google Chrome", "Safari", "Arc", "Firefox", "Microsoft Edge", "Brave Browser", "Vivaldi", "Opera"];
    // Use the matched allowlist entry (not the raw OS value) to prevent AppleScript injection
    const matchedBrowser = knownBrowsers.find((b) => browserName.includes(b));
    if (matchedBrowser) {
      try {
        let urlScript: string;
        if (matchedBrowser === "Safari") {
          urlScript = `tell application "Safari" to return URL of front document`;
        } else if (matchedBrowser === "Firefox") {
          // Firefox doesn't support AppleScript URL access — skip
          urlScript = "";
        } else {
          // Chromium-based browsers — use the allowlisted name, never the raw OS value
          urlScript = `tell application "${matchedBrowser}" to return URL of active tab of front window`;
        }
        if (urlScript) {
          const url = await execPromise(`osascript -e '${urlScript.replace(/'/g, "'\\''")}'`);
          if (url && url.startsWith("http")) {
            result.activeUrl = url;
          }
        }
      } catch {
        // URL access may fail due to permissions — non-fatal
      }
    }
  }

  return result;
}

async function collectWindowsMetadata(): Promise<Partial<ScreenCaptureMetadata>> {
  const result: Partial<ScreenCaptureMetadata> = {};

  try {
    // PowerShell: get foreground window title and process name
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class WinAPI {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        }
"@
      $hwnd = [WinAPI]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 256
      [WinAPI]::GetWindowText($hwnd, $sb, 256) | Out-Null
      $title = $sb.ToString()
      $pid = 0
      [WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      $name = if ($proc) { $proc.ProcessName } else { "" }
      "$name|||$title"
    `.trim();

    const raw = await execPromise(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`);
    const [appName, windowTitle] = raw.split("|||");
    if (appName) result.activeAppName = appName.trim();
    if (windowTitle) result.activeWindowTitle = windowTitle.trim();
  } catch (error) {
    debugError("[MetadataCollector] Windows PowerShell failed:", error);
  }

  return result;
}

export async function collectMetadata(options?: {
  displayIndex?: number;
  resolution?: { width: number; height: number };
}): Promise<ScreenCaptureMetadata> {
  const base: ScreenCaptureMetadata = {
    capturedAt: new Date().toISOString(),
    captureMode: "display",
  };

  if (options?.displayIndex !== undefined) {
    base.displayIndex = options.displayIndex;
  }
  if (options?.resolution) {
    base.originalResolution = options.resolution;
  }

  let platformMeta: Partial<ScreenCaptureMetadata> = {};

  // Aggregate timeout prevents blocking the unified capture pipeline for more than 2s
  // (worst case: two sequential 3s AppleScript calls = 6s without this guard)
  const AGGREGATE_TIMEOUT_MS = 2000;

  try {
    const platformPromise = process.platform === "darwin"
      ? collectMacOSMetadata()
      : process.platform === "win32"
        ? collectWindowsMetadata()
        : Promise.resolve({});

    const timeoutPromise = new Promise<Partial<ScreenCaptureMetadata>>((resolve) => {
      setTimeout(() => resolve({}), AGGREGATE_TIMEOUT_MS);
    });

    platformMeta = await Promise.race([platformPromise, timeoutPromise]);
    // Linux: no metadata collection for now — can add xdotool later
  } catch (error) {
    debugError("[MetadataCollector] Platform metadata collection failed:", error);
  }

  return { ...base, ...platformMeta };
}
