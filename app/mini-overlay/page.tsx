"use client";
import { Suspense, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useMiniPipeline } from "@/lib/hooks/use-mini-pipeline";
import { useOverlayAgentPicker } from "@/lib/hooks/use-overlay-agent-picker";
import { useOverlayMode } from "@/lib/hooks/use-overlay-mode";
import { RecordingPill } from "@/components/mini-overlay/recording-pill";
import { AgentPicker } from "@/components/mini-overlay/agent-picker";
import { ModeToggle } from "@/components/mini-overlay/mode-toggle";
import { getElectronAPI } from "@/lib/electron/types";

function MiniOverlayContent() {
  const searchParams = useSearchParams();
  // URL params are treated as override/fallback — agent picker takes precedence when available
  const sessionIdParam = searchParams.get("sessionId") ?? undefined;
  const characterIdParam = searchParams.get("characterId") ?? undefined;
  const screenshotUrl = searchParams.get("screenshotUrl") ?? undefined;

  const { agents, selectedAgent, selectAgent, loading: agentLoading } = useOverlayAgentPicker();
  const { mode, setMode } = useOverlayMode();

  // Resolve the effective characterId and sessionId from the picker or URL params
  const characterId = selectedAgent?.id ?? characterIdParam;
  const sessionId = selectedAgent?.lastSessionId ?? sessionIdParam;
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

  const handleComposeReady = useCallback((payload: { transcript: string; screenshotUrl?: string; characterId?: string; sessionId?: string }) => {
    const api = getElectronAPI();
    api?.ipc?.invoke("mini-overlay:compose-ready", payload).catch(() => {});
  }, []);

  const pipeline = useMiniPipeline({
    sessionId,
    characterId,
    screenshotUrl,
    autoStart: true,
    mode,
    onDone: handleDone,
    onComposeReady: handleComposeReady,
  });

  // Report phase to main process
  useEffect(() => {
    const api = getElectronAPI();
    api?.ipc?.send("mini-overlay:phase-update", pipeline.phase);
  }, [pipeline.phase]);

  // Listen for overlay:toggle-recording — same shortcut toggles behavior:
  // If currently recording → stop and proceed to transcribe/AI/TTS
  // If idle/done/error → start a fresh recording
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;
    const handleToggle = () => {
      if (pipeline.phase === "recording") {
        // Second press: stop recording → pipeline proceeds to transcribing
        pipeline.stopRecording();
      } else if (pipeline.phase === "idle" || pipeline.phase === "done" || pipeline.phase === "error") {
        // Start a fresh recording
        if (doneTimerRef.current) {
          clearTimeout(doneTimerRef.current);
          doneTimerRef.current = null;
        }
        pipeline.cancel();
        setTimeout(() => {
          pipeline.startRecording();
        }, 100);
      }
      // During transcribing/thinking/speaking — ignore the shortcut (pipeline is working)
    };
    api.ipc.on("overlay:toggle-recording", handleToggle);
    return () => {
      api?.ipc?.removeAllListeners?.("overlay:toggle-recording");
    };
  }, [pipeline.phase, pipeline.stopRecording, pipeline.cancel, pipeline.startRecording]);

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

  const isActivePipeline = pipeline.phase !== "idle" && pipeline.phase !== "done" && pipeline.phase !== "error";

  return (
    <div className="flex items-start justify-center w-full h-full">
      <RecordingPill
        phase={pipeline.phase}
        transcript={pipeline.transcript}
        response={pipeline.response}
        error={pipeline.error}
        analyserNode={pipeline.analyserNode}
        onCancel={handleCancel}
        onClose={handleClose}
        onStopRecording={handleStopRecording}
        screenshotUrl={screenshotUrl}
        agentPicker={
          !agentLoading && agents.length > 0 ? (
            <AgentPicker
              agents={agents}
              selectedAgent={selectedAgent}
              onSelectAgent={selectAgent}
            />
          ) : null
        }
        modeToggle={
          <ModeToggle
            mode={mode}
            onChange={setMode}
            disabled={isActivePipeline}
          />
        }
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
