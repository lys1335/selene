"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getElectronAPI, type ScreenCaptureResult } from "@/lib/electron/types";

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
        toast.error(result.error || "Screen capture failed");
        return;
      }

      const file = buildScreenCaptureFile(result);
      if (!file || !result.imageUrl) {
        toast.error("Captured screenshot is unavailable");
        return;
      }

      try {
        const response = await fetch(result.imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to read screenshot (${response.status})`);
        }

        const blob = await response.blob();
        const hydratedFile = new File([blob], file.name, {
          type: blob.type || "image/png",
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
