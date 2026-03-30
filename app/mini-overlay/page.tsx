"use client";
import { Suspense, useEffect, useCallback, useState, useRef } from "react";
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
  const { mode, setMode, voicePostProcessing, autoCloseAfterSpeak, showScreenPreview, ttsReadCodeBlocks } = useOverlayMode();

  // Resolve the effective characterId and sessionId from the picker or URL params
  const characterId = selectedAgent?.id ?? characterIdParam;
  const sessionId = selectedAgent?.lastSessionId ?? sessionIdParam;
  const hasResolvedTarget = Boolean(characterId) && (!agentLoading || Boolean(characterIdParam));

  // ---------------------------------------------------------------------------
  // Additional screenshots added via Cmd+Shift+S while overlay is active
  // ---------------------------------------------------------------------------
  const [additionalScreenshots, setAdditionalScreenshots] = useState<string[]>([]);
  const additionalScreenshotsRef = useRef<string[]>([]);

  // ---------------------------------------------------------------------------
  // Compose handoff — invoked when pipeline.confirmCompose() fires onComposeReady
  // ---------------------------------------------------------------------------
  const handleComposeReady = useCallback(
    async (payload: { transcript: string; screenshotUrl?: string; screenshotUrls?: string[]; characterId?: string; sessionId?: string }) => {
      const api = getElectronAPI();
      try {
        await api?.ipc?.invoke("mini-overlay:compose-ready", payload);
      } catch {}
      // Close the overlay after successful handoff to the main app
      api?.ipc?.send("mini-overlay:dismiss");
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Pipeline — voicePostProcessing enabled by default
  // ---------------------------------------------------------------------------
  const pipeline = useMiniPipeline({
    sessionId,
    characterId,
    screenshotUrl,
    screenshotUrls: additionalScreenshots,
    autoStart: hasResolvedTarget,
    mode,
    voicePostProcessing,
    ttsReadCodeBlocks,
    onComposeReady: handleComposeReady,
  });

  // Report phase to main process
  useEffect(() => {
    const api = getElectronAPI();
    api?.ipc?.send("mini-overlay:phase-update", pipeline.phase);
  }, [pipeline.phase]);

  // Auto-close after speak (direct mode done) if setting is enabled
  useEffect(() => {
    if (pipeline.phase !== "done" || mode !== "direct" || !autoCloseAfterSpeak || !pipeline.shouldAutoClose) return;
    const timer = setTimeout(() => {
      const api = getElectronAPI();
      api?.ipc?.send("mini-overlay:dismiss");
    }, 1500);
    return () => clearTimeout(timer);
  }, [pipeline.phase, pipeline.shouldAutoClose, mode, autoCloseAfterSpeak]);

  // ---------------------------------------------------------------------------
  // Shortcut toggle: same shortcut toggles recording behavior
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;
    const handleToggle = () => {
      if (pipeline.phase === "recording") {
        // Second press: stop recording → pipeline proceeds to transcribing
        pipeline.stopRecording();
      } else if (!hasResolvedTarget) {
        return;
      } else if (pipeline.phase === "idle" || pipeline.phase === "done" || pipeline.phase === "error") {
        // Start a fresh recording
        pipeline.cancel();
        setTimeout(() => {
          pipeline.startRecording();
        }, 100);
      } else if (pipeline.phase === "compose-review") {
        // Shortcut in compose-review = confirm handoff
        pipeline.confirmCompose();
      }
      // During transcribing/refining/thinking/speaking/compose-pending — ignore
    };
    api.ipc.on("overlay:toggle-recording", handleToggle);
    return () => {
      api?.ipc?.removeAllListeners?.("overlay:toggle-recording");
    };
  }, [hasResolvedTarget, pipeline.phase, pipeline.stopRecording, pipeline.cancel, pipeline.startRecording, pipeline.confirmCompose]);

  // ---------------------------------------------------------------------------
  // IPC listener for additional screenshots (Cmd+Shift+S while overlay is active)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;
    const handleAddScreenshot = (url: unknown) => {
      if (typeof url === "string") {
        setAdditionalScreenshots((prev) => {
          const next = [...prev, url];
          additionalScreenshotsRef.current = next;
          return next;
        });
      }
    };
    api.ipc.on("overlay:add-screenshot", handleAddScreenshot);
    return () => {
      api?.ipc?.removeAllListeners?.("overlay:add-screenshot");
    };
  }, []);

  // Combine initial screenshot with any additional ones
  const allScreenshots = [
    ...(screenshotUrl ? [screenshotUrl] : []),
    ...additionalScreenshots,
  ];

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Cancel and close the overlay entirely. */
  const handleCancel = useCallback(() => {
    pipeline.cancel();
    const api = getElectronAPI();
    api?.ipc?.send("mini-overlay:close");
  }, [pipeline.cancel]);

  /** Compose-review: user clicks "Open in Selene". */
  const handleConfirmCompose = useCallback(() => {
    pipeline.confirmCompose();
  }, [pipeline.confirmCompose]);

  /** Done phase: user clicks "Close" to dismiss overlay. */
  const handleDismiss = useCallback(() => {
    const api = getElectronAPI();
    api?.ipc?.send("mini-overlay:dismiss");
  }, []);

  const handleClose = handleCancel;

  // Stop recording on second press of shortcut or click
  const handleStopRecording = useCallback(() => {
    if (pipeline.phase === "recording") {
      pipeline.stopRecording();
    }
  }, [pipeline.phase, pipeline.stopRecording]);

  // Stop TTS playback early — transitions to done without resetting transcript/response
  const handleStopSpeaking = useCallback(() => {
    pipeline.stopSpeaking();
  }, [pipeline.stopSpeaking]);

  // Allow mode switching during recording — mode only matters after transcription
  const isModeChangeBlocked =
    pipeline.phase !== "idle" &&
    pipeline.phase !== "done" &&
    pipeline.phase !== "error" &&
    pipeline.phase !== "recording";

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
        onConfirmCompose={handleConfirmCompose}
        onDismiss={handleDismiss}
        onStopSpeaking={handleStopSpeaking}
        screenshotUrls={showScreenPreview ? allScreenshots : undefined}
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
            disabled={isModeChangeBlocked}
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
