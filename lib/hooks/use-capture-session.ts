"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CapturePhase =
  | "idle"
  | "capturing"     // Screenshot in progress (~200ms)
  | "recording"     // Voice recording active, screenshot attached
  | "transcribing"  // STT processing
  | "reviewing"     // Text ready, optional auto-send countdown
  | "sending";      // Brief state while message sends

export type CaptureSessionMetadata = {
  activeWindowTitle?: string;
  activeAppName?: string;
  browserUrl?: string;
};

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
  onClearAttachments?: () => void;
}) {
  const { isRecordingVoice, isTranscribingVoice, autoSendEnabled, autoSendDelay, onSend, onClearAttachments } = options;

  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isUnifiedSession, setIsUnifiedSession] = useState(false);
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const [sendAfterTranscription, setSendAfterTranscription] = useState(false);
  const [metadata, setMetadata] = useState<CaptureSessionMetadata | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stores the brief 200ms post-send cleanup timer so it can be cancelled on unmount
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  // Start a unified capture session (called from useUnifiedCapture's onSessionStarted)
  const startSession = useCallback((imageUrl?: string, captureMetadata?: CaptureSessionMetadata) => {
    setIsUnifiedSession(true);
    setScreenshotUrl(imageUrl || null);
    setMetadata(captureMetadata || null);
    setPhase("capturing");
    setSendAfterTranscription(false);
  }, []);

  // Safety timeout: if stuck in "capturing" for >5s (mic failed, screenshot hung),
  // auto-cancel to prevent permanent overlay
  useEffect(() => {
    if (phase === "capturing" && isUnifiedSession) {
      stuckTimerRef.current = setTimeout(() => {
        stuckTimerRef.current = null;
        console.warn("[useCaptureSession] Stuck in capturing phase for 5s, auto-cancelling");
        setPhase("idle");
        setIsUnifiedSession(false);
        setScreenshotUrl(null);
        setMetadata(null);
        setSendAfterTranscription(false);
        // Clear any screenshot that may have been attached before the hang
        onClearAttachments?.();
      }, 5000);
      return () => {
        if (stuckTimerRef.current) {
          clearTimeout(stuckTimerRef.current);
          stuckTimerRef.current = null;
        }
      };
    }
  }, [phase, isUnifiedSession, onClearAttachments]);

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
      // If sendAfterTranscription flag is set (Stop & Send was clicked), send immediately
      if (sendAfterTranscription) {
        setPhase("sending");
        setSendAfterTranscription(false);
        onSendRef.current();
        cleanupTimerRef.current = setTimeout(() => {
          cleanupTimerRef.current = null;
          setPhase("idle");
          setIsUnifiedSession(false);
          setScreenshotUrl(null);
          setMetadata(null);
        }, 200);
      } else {
        setPhase("reviewing");
      }
    }
  }, [isRecordingVoice, isTranscribingVoice, phase, isUnifiedSession, sendAfterTranscription]);

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
      autoSendTimerRef.current = null;
      setPhase("sending");
      onSendRef.current();
      // Reset after brief delay — stored in ref so it can be cancelled on unmount
      cleanupTimerRef.current = setTimeout(() => {
        cleanupTimerRef.current = null;
        setPhase("idle");
        setIsUnifiedSession(false);
        setScreenshotUrl(null);
        setMetadata(null);
      }, 200);
    }, delay * 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    };
  }, [phase, autoSendEnabled, autoSendDelay, isUnifiedSession]);

  // Cancel the entire session — also clears screenshot attachment from composer
  const cancelSession = useCallback(() => {
    setPhase("idle");
    setIsUnifiedSession(false);
    setScreenshotUrl(null);
    setMetadata(null);
    setCountdownRemaining(0);
    setSendAfterTranscription(false);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    // Clear the screenshot attachment that was added to the composer
    onClearAttachments?.();
  }, [onClearAttachments]);

  // Stop recording and send as soon as transcription completes
  const stopAndSend = useCallback(() => {
    setSendAfterTranscription(true);
  }, []);

  // End session without clearing attachments (used after successful send)
  const endSession = useCallback(() => {
    setPhase("idle");
    setIsUnifiedSession(false);
    setScreenshotUrl(null);
    setMetadata(null);
    setCountdownRemaining(0);
    setSendAfterTranscription(false);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
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
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
    };
  }, []);

  return {
    phase,
    screenshotUrl,
    isUnifiedSession,
    countdownRemaining,
    metadata,
    startSession,
    cancelSession,
    cancelAutoSend,
    stopAndSend,
    endSession,
  };
}
