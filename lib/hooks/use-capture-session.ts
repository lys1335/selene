"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CapturePhase =
  | "idle"
  | "capturing"     // Screenshot in progress (~200ms)
  | "recording"     // Voice recording active, screenshot attached
  | "transcribing"  // STT processing
  | "reviewing"     // Text ready, optional auto-send countdown
  | "sending";      // Brief state while message sends

/**
 * Higher-level coordinator for unified voice+screen capture sessions.
 *
 * Observes external voice recording state (from useVoiceRecording) and
 * manages the capture session lifecycle: capturing → recording → transcribing → reviewing.
 *
 * Auto-send countdown fires in the reviewing phase if enabled.
 */
export function useCaptureSession(options: {
  isRecordingVoice: boolean;
  isTranscribingVoice: boolean;
  autoSendEnabled: boolean;
  autoSendDelay: number; // seconds
  onSend: () => void;
}) {
  const { isRecordingVoice, isTranscribingVoice, autoSendEnabled, autoSendDelay, onSend } = options;

  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isUnifiedSession, setIsUnifiedSession] = useState(false);
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  // Start a unified capture session (called from useUnifiedCapture's onSessionStarted)
  const startSession = useCallback((imageUrl?: string) => {
    setIsUnifiedSession(true);
    setScreenshotUrl(imageUrl || null);
    setPhase("capturing");
  }, []);

  // Screenshot attached — transition capturing → recording if voice is active
  const onScreenshotAttached = useCallback((url: string) => {
    setScreenshotUrl(url);
  }, []);

  // Observe voice state transitions during a unified session
  useEffect(() => {
    if (!isUnifiedSession) return;

    if (isRecordingVoice && (phase === "capturing" || phase === "idle")) {
      setPhase("recording");
    } else if (isTranscribingVoice && (phase === "recording" || phase === "capturing")) {
      setPhase("transcribing");
    } else if (
      !isRecordingVoice &&
      !isTranscribingVoice &&
      (phase === "recording" || phase === "transcribing")
    ) {
      // Transcription complete — move to reviewing
      setPhase("reviewing");
    }
  }, [isRecordingVoice, isTranscribingVoice, phase, isUnifiedSession]);

  // Auto-send countdown in reviewing phase
  useEffect(() => {
    if (phase !== "reviewing" || !autoSendEnabled || !isUnifiedSession) {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
        autoSendTimerRef.current = null;
      }
      setCountdownRemaining(0);
      return;
    }

    const delay = Math.max(1, autoSendDelay);
    setCountdownRemaining(delay);

    countdownRef.current = setInterval(() => {
      setCountdownRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    autoSendTimerRef.current = setTimeout(() => {
      setPhase("sending");
      onSendRef.current();
      // Reset after brief delay
      setTimeout(() => {
        setPhase("idle");
        setIsUnifiedSession(false);
        setScreenshotUrl(null);
      }, 200);
    }, delay * 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    };
  }, [phase, autoSendEnabled, autoSendDelay, isUnifiedSession]);

  // Cancel the entire session
  const cancelSession = useCallback(() => {
    setPhase("idle");
    setIsUnifiedSession(false);
    setScreenshotUrl(null);
    setCountdownRemaining(0);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
  }, []);

  // Cancel just the auto-send countdown (e.g. user started editing text)
  const cancelAutoSend = useCallback(() => {
    setCountdownRemaining(0);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    };
  }, []);

  return {
    phase,
    screenshotUrl,
    isUnifiedSession,
    countdownRemaining,
    startSession,
    onScreenshotAttached,
    cancelSession,
    cancelAutoSend,
  };
}
