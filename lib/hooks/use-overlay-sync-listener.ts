"use client";
import { useEffect } from "react";
import { getElectronAPI } from "@/lib/electron/types";

interface UseOverlaySyncListenerOptions {
  activeSessionId: string | undefined;
  onSessionUpdated: (sessionId: string) => void;
  onComposeInject: (payload: { transcript: string; screenshotUrl?: string; characterId?: string; sessionId?: string }) => void;
}

/**
 * Main window hook that listens for overlay events forwarded from the overlay
 * renderer via the Electron main process.
 *
 * - "overlay:session-updated": fired after a successful direct-mode chat POST.
 *   If the payload's sessionId matches activeSessionId, onSessionUpdated is called.
 *
 * - "overlay:compose-inject": fired when compose mode completes transcription.
 *   Calls onComposeInject with the transcript and optional screenshot payload.
 */
export function useOverlaySyncListener({
  activeSessionId,
  onSessionUpdated,
  onComposeInject,
}: UseOverlaySyncListenerOptions): void {
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;

    const handleSessionUpdated = (payload: unknown) => {
      const data = payload as { sessionId?: string; characterId?: string } | undefined;
      if (!data) return;
      if (data.sessionId && data.sessionId === activeSessionId) {
        onSessionUpdated(data.sessionId);
      }
    };

    const handleComposeInject = (payload: unknown) => {
      const data = payload as { transcript: string; screenshotUrl?: string; characterId?: string; sessionId?: string } | undefined;
      if (!data) return;
      onComposeInject(data);
    };

    api.ipc.on("overlay:session-updated", handleSessionUpdated);
    api.ipc.on("overlay:compose-inject", handleComposeInject);

    return () => {
      api?.ipc?.removeAllListeners?.("overlay:session-updated");
      api?.ipc?.removeAllListeners?.("overlay:compose-inject");
    };
  }, [activeSessionId, onSessionUpdated, onComposeInject]);
}
