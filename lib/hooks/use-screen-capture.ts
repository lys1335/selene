"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getElectronAPI, type ScreenCaptureResult } from "@/lib/electron/types";
import { optimizeScreenshot } from "@/lib/voice-screen/image-optimization";
import { showPermissionToast } from "@/lib/electron/permission-toast";

function buildScreenCaptureFile(result: ScreenCaptureResult): File | null {
  if (!result.success || !result.imageUrl) {
    return null;
  }

  const fileName = result.relativePath?.split("/").pop() || "screenshot.png";
  return new File([], fileName, {
    type: "image/png",
  });
}

export function useScreenCapture(options: {
  enabled?: boolean;
  onCaptured: (file: File) => Promise<void>;
}) {
  const { enabled = true, onCaptured } = options;
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCaptured = useCallback(
    async (result: ScreenCaptureResult) => {
      if (!enabled) {
        return;
      }

      if (!result.success) {
        if (result.permissionStatus === "denied" || result.permissionStatus === "restricted") {
          showPermissionToast("screen");
        } else {
          toast.error(result.error || "Screen capture failed");
        }
        return;
      }

      const file = buildScreenCaptureFile(result);
      if (!file || !result.imageUrl) {
        toast.error("Captured screenshot is unavailable");
        return;
      }

      try {
        let blob: Blob;
        try {
          blob = await optimizeScreenshot(result.imageUrl);
        } catch {
          // Fallback to original if optimization fails
          const response = await fetch(result.imageUrl);
          if (!response.ok) {
            throw new Error(`Failed to read screenshot (${response.status})`);
          }
          blob = await response.blob();
        }

        const baseName = file.name.replace(/\.[^.]+$/, "");
        const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
        const fileName = `${baseName}.${ext}`;
        const hydratedFile = new File([blob], fileName, {
          type: blob.type || "image/jpeg",
          lastModified: Date.now(),
        });

        await onCaptured(hydratedFile);
        toast.success("Screenshot attached");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to attach screenshot";
        toast.error(message);
      }
    },
    [enabled, onCaptured]
  );

  const captureNow = useCallback(async () => {
    const electron = getElectronAPI();
    if (!electron?.screenCapture) {
      toast.error("Screen capture is only available in the desktop app");
      return;
    }

    setIsCapturing(true);
    try {
      const result = await electron.screenCapture.capture();
      await handleCaptured(result);
    } finally {
      setIsCapturing(false);
    }
  }, [handleCaptured]);

  useEffect(() => {
    const electron = getElectronAPI();
    if (!electron?.screenCapture || !enabled) {
      return;
    }

    return electron.screenCapture.onCaptured((result) => {
      void handleCaptured(result);
    });
  }, [enabled, handleCaptured]);

  return {
    captureNow,
    isCapturing,
  };
}
