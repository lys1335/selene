"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { getElectronAPI, type UnifiedCaptureTriggerPayload, UNIFIED_CAPTURE_DEBOUNCE_MARKER } from "@/lib/electron/types";
import { optimizeScreenshot } from "@/lib/voice-screen/image-optimization";

/**
 * Hook that listens for unified capture events from the Electron main process.
 *
 * When the unified shortcut fires (Cmd+Shift+A), this hook:
 * 1. Triggers voice recording start (immediately, never blocked by screenshot)
 * 2. Attaches the screenshot to the active composer (async, in parallel)
 *
 * Voice recording never depends on screenshot success — if capture fails,
 * voice still starts. If mic fails, screenshot still attaches.
 */
export type CaptureEventMetadata = {
  activeWindowTitle?: string;
  activeAppName?: string;
  browserUrl?: string;
};

export function useUnifiedCapture(options: {
  enabled?: boolean;
  /** When true (another session already active), ignore incoming shortcut triggers */
  isSessionActive?: boolean;
  onScreenshotCaptured: (file: File) => Promise<void>;
  onStartVoice: () => void;
  onSessionStarted?: (screenshotUrl: string | undefined, metadata?: CaptureEventMetadata) => void;
  isDeepResearchMode?: boolean;
}) {
  const { enabled = true, isSessionActive = false, onScreenshotCaptured, onStartVoice, onSessionStarted, isDeepResearchMode = false } = options;
  const processingRef = useRef(false);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up pending voice timer on unmount
  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) {
        clearTimeout(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
    };
  }, []);

  const handleTriggered = useCallback(
    (payload: UnifiedCaptureTriggerPayload) => {
      // Ignore if another unified session is already active or a trigger is being processed
      if (!enabled || processingRef.current || isSessionActive) return;
      processingRef.current = true;

      try {
        // Notify capture session coordinator that a unified session started, with metadata
        onSessionStarted?.(payload.screenshot?.url, payload.metadata ? {
          activeWindowTitle: payload.metadata.activeWindowTitle,
          activeAppName: payload.metadata.activeAppName,
          browserUrl: payload.metadata.activeUrl,
        } : undefined);

        // Voice starts IMMEDIATELY — never blocked by screenshot fetch/attachment.
        // Small delay only to let the window finish focusing.
        if (payload.startVoice) {
          if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
          voiceTimerRef.current = setTimeout(() => {
            voiceTimerRef.current = null;
            onStartVoice();
          }, 150);
        }

        // Screenshot attachment runs in parallel — errors are non-fatal
        const attachScreenshot = async () => {
          if (payload.screenshot?.url && !isDeepResearchMode) {
            try {
              let blob: Blob;
              try {
                blob = await optimizeScreenshot(payload.screenshot.url);
              } catch {
                // Fallback to original if optimization fails
                const response = await fetch(payload.screenshot.url);
                if (!response.ok) {
                  throw new Error(`Failed to read screenshot (${response.status})`);
                }
                blob = await response.blob();
              }
              const rawName = payload.screenshot.filePath.split("/").pop() || `capture-${payload.traceId}`;
              const baseName = rawName.replace(/\.[^.]+$/, "");
              const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
              const fileName = `${baseName}.${ext}`;
              const file = new File([blob], fileName, {
                type: blob.type || "image/jpeg",
                lastModified: Date.now(),
              });
              await onScreenshotCaptured(file);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to attach screenshot";
              toast.error(message);
            }
          } else if (payload.screenshotError) {
            if (!payload.screenshotError?.includes(UNIFIED_CAPTURE_DEBOUNCE_MARKER)) {
              toast.warning(payload.screenshotError);
            }
          } else if (isDeepResearchMode && payload.screenshot) {
            toast.warning("Screen capture is not available in Deep Research mode");
          }

          // Show metadata context in a subtle toast if available
          if (payload.metadata?.activeWindowTitle) {
            const context = payload.metadata.activeAppName
              ? `${payload.metadata.activeAppName}: ${payload.metadata.activeWindowTitle}`
              : payload.metadata.activeWindowTitle;
            const truncated = context.length > 80 ? context.slice(0, 77) + "..." : context;
            toast.info(`Captured: ${truncated}`, { duration: 2000 });
          }
        };

        void attachScreenshot().finally(() => {
          processingRef.current = false;
        });
      } catch {
        // Ensure processingRef is always released if synchronous setup throws
        processingRef.current = false;
      }
    },
    [enabled, isSessionActive, onScreenshotCaptured, onStartVoice, onSessionStarted, isDeepResearchMode]
  );

  useEffect(() => {
    const electron = getElectronAPI();
    if (!electron?.unifiedCapture || !enabled) {
      return;
    }

    return electron.unifiedCapture.onTriggered((payload) => {
      handleTriggered(payload);
    });
  }, [enabled, handleTriggered]);
}
