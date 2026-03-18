"use client";
import { Suspense, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useMiniPipeline } from "@/lib/hooks/use-mini-pipeline";
import { RecordingPill } from "@/components/mini-overlay/recording-pill";
import { getElectronAPI } from "@/lib/electron/types";

function MiniOverlayContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") ?? undefined;
  const characterId = searchParams.get("characterId") ?? undefined;
  const screenshotUrl = searchParams.get("screenshotUrl") ?? undefined;
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
    };
  }, []);

  const handleDone = useCallback(() => {
    const api = getElectronAPI();
    // Return focus to previous app, then close overlay after a brief delay
    doneTimerRef.current = setTimeout(async () => {
      doneTimerRef.current = null;
      try {
        await api?.ipc?.invoke("mini-overlay:request-focus-return");
      } catch {}
      api?.ipc?.send("mini-overlay:close");
    }, 1500);
  }, []);

  const pipeline = useMiniPipeline({
    sessionId,
    characterId,
    screenshotUrl,
    autoStart: true,
    onDone: handleDone,
  });

  // Report phase to main process
  useEffect(() => {
    const api = getElectronAPI();
    api?.ipc?.send("mini-overlay:phase-update", pipeline.phase);
  }, [pipeline.phase]);

  const handleCancel = useCallback(() => {
    pipeline.cancel();
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    const api = getElectronAPI();
    api?.ipc?.send("mini-overlay:close");
  }, [pipeline.cancel]);

  const handleClose = handleCancel;

  // Stop recording on second press of shortcut or click
  const handleStopRecording = useCallback(() => {
    if (pipeline.phase === "recording") {
      pipeline.stopRecording();
    }
  }, [pipeline.phase, pipeline.stopRecording]);

  return (
    <div
      className="flex items-start justify-center pt-4 w-full h-full"
      onClick={pipeline.phase === "recording" ? handleStopRecording : undefined}
    >
      <RecordingPill
        phase={pipeline.phase}
        transcript={pipeline.transcript}
        response={pipeline.response}
        error={pipeline.error}
        analyserNode={pipeline.analyserNode}
        onCancel={handleCancel}
        onClose={handleClose}
      />
    </div>
  );
}

export default function MiniOverlayPage() {
  return (
    <Suspense fallback={<div />}>
      <MiniOverlayContent />
    </Suspense>
  );
}
