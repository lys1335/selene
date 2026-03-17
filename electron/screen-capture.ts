import { desktopCapturer, screen, systemPreferences } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_SCREEN_CAPTURE_HOTKEY = "CommandOrControl+Shift+S";

export type ScreenCapturePermissionStatus =
  | "granted"
  | "denied"
  | "restricted"
  | "not-determined"
  | "unknown";

export interface ScreenCaptureResult {
  success: boolean;
  imageUrl?: string;
  relativePath?: string;
  width?: number;
  height?: number;
  error?: string;
  permissionStatus: ScreenCapturePermissionStatus;
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureScreenshotsDir(mediaDir: string): string {
  const screenshotsDir = path.join(mediaDir, "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  return screenshotsDir;
}

const SCREENSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Delete screenshot files older than SCREENSHOT_TTL_MS.
 * Call once at app startup to prevent unbounded disk growth.
 */
export function cleanOldScreenshots(mediaDir: string): void {
  const screenshotsDir = path.join(mediaDir, "screenshots");
  if (!fs.existsSync(screenshotsDir)) return;
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(screenshotsDir)) {
      if (!file.endsWith(".png")) continue;
      const fullPath = path.join(screenshotsDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > SCREENSHOT_TTL_MS) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Non-fatal: file may have been deleted concurrently
      }
    }
  } catch (err) {
    console.warn("[screen-capture] cleanOldScreenshots failed:", err);
  }
}

function buildCaptureError(permissionStatus: ScreenCapturePermissionStatus, fallback: string): ScreenCaptureResult {
  if (permissionStatus === "denied" || permissionStatus === "restricted") {
    return {
      success: false,
      permissionStatus,
      error: "Screen capture requires Screen Recording permission in system settings.",
    };
  }

  return {
    success: false,
    permissionStatus,
    error: fallback,
  };
}

export function getScreenCapturePermissionStatus(): ScreenCapturePermissionStatus {
  if (process.platform !== "darwin") {
    return "granted";
  }

  const status = systemPreferences.getMediaAccessStatus("screen");
  if (
    status === "granted"
    || status === "denied"
    || status === "restricted"
    || status === "not-determined"
  ) {
    return status;
  }

  return "unknown";
}

export async function captureDisplay(options: { mediaDir: string }): Promise<ScreenCaptureResult> {
  const permissionStatus = getScreenCapturePermissionStatus();
  if (permissionStatus === "denied" || permissionStatus === "restricted") {
    return buildCaptureError(permissionStatus, "Screen capture is unavailable.");
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
  const scaleFactor = targetDisplay.scaleFactor || 1;
  const captureWidth = Math.max(1, Math.round(targetDisplay.bounds.width * scaleFactor));
  const captureHeight = Math.max(1, Math.round(targetDisplay.bounds.height * scaleFactor));

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: captureWidth,
      height: captureHeight,
    },
    fetchWindowIcons: false,
  });

  const displayId = String(targetDisplay.id);
  const selectedSource = sources.find((source) => String(source.display_id || "") === displayId) || sources[0];

  if (!selectedSource) {
    return buildCaptureError(permissionStatus, "No displays are available to capture.");
  }

  const image = selectedSource.thumbnail;
  if (!image || image.isEmpty()) {
    return buildCaptureError(permissionStatus, "Failed to capture the current display.");
  }

  const screenshotsDir = ensureScreenshotsDir(options.mediaDir);
  const fileName = `screenshot-${getTimestamp()}.png`;
  const fullPath = path.join(screenshotsDir, fileName);
  fs.writeFileSync(fullPath, image.toPNG());

  const relativePath = path.posix.join("screenshots", fileName);
  const imageSize = image.getSize();

  return {
    success: true,
    permissionStatus,
    relativePath,
    imageUrl: `/api/media/${relativePath}`,
    width: imageSize.width,
    height: imageSize.height,
  };
}
