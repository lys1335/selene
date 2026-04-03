"use client";

import { useState, useRef, useCallback } from "react";

interface UseEdgeTtsPreviewOptions {
  /** The voice ID to preview. */
  voiceId: string;
}

interface UseEdgeTtsPreviewResult {
  previewing: boolean;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  stopPreview: () => void;
  playPreview: () => Promise<void>;
}

/**
 * Manages audio playback for Edge TTS voice preview.
 *
 * Fetches /api/tts/preview for the given voiceId, plays the blob through an
 * HTMLAudioElement, and cleans up the object URL on stop or unmount.
 */
export function useEdgeTtsPreview({ voiceId }: UseEdgeTtsPreviewOptions): UseEdgeTtsPreviewResult {
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPreviewing(false);
  }, []);

  const playPreview = useCallback(async () => {
    if (previewing) {
      stopPreview();
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch(`/api/tts/preview?voice=${encodeURIComponent(voiceId)}`);
      if (!res.ok) throw new Error("Preview failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = stopPreview;
      audio.onerror = stopPreview;
      await audio.play();
    } catch {
      stopPreview();
    }
  }, [voiceId, previewing, stopPreview]);

  return { previewing, audioRef, stopPreview, playPreview };
}
