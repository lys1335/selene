"use client";

import type { FC } from "react";
import { cn } from "@/lib/utils";
import { Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceWaveform } from "@/components/voice/voice-waveform";
import type { CapturePhase } from "@/lib/hooks/use-capture-session";

interface UnifiedCaptureOverlayProps {
  phase: CapturePhase;
  screenshotUrl: string | null;
  isRecording: boolean;
  analyserNode: AnalyserNode | null;
  onCancel: () => void;
  onStopRecording: () => void;
  className?: string;
}

/**
 * Combined screenshot preview + voice waveform overlay shown during
 * unified capture sessions (Cmd+Shift+A flow).
 *
 * Replaces the standalone VoiceWaveform when a unified session is active.
 */
export const UnifiedCaptureOverlay: FC<UnifiedCaptureOverlayProps> = ({
  phase,
  screenshotUrl,
  isRecording,
  analyserNode,
  onCancel,
  onStopRecording,
  className,
}) => {
  if (phase === "idle" || phase === "sending") return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 border-b border-terminal-dark/10",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        className,
      )}
      role="region"
      aria-label="Screen capture and voice recording session"
      aria-live="assertive"
    >
      {/* Capturing skeleton */}
      {phase === "capturing" && (
        <div className="flex items-center gap-2 rounded-lg bg-terminal-dark/5 px-3 py-4 text-xs font-mono text-terminal-muted">
          <Loader2Icon className="size-3 animate-spin" />
          <span>Capturing screen...</span>
        </div>
      )}

      {/* Screenshot preview — visible during recording, transcribing, reviewing */}
      {screenshotUrl && phase !== "capturing" && (
        <div className="relative group">
          <img
            src={screenshotUrl}
            alt="Captured screen"
            className="rounded-lg border border-terminal-dark/10 max-h-48 w-full object-contain bg-terminal-dark/5"
          />
          <button
            onClick={onCancel}
            className="absolute top-1.5 right-1.5 size-6 rounded-full bg-terminal-dark/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Remove screenshot"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Recording waveform */}
      {phase === "recording" && (
        <VoiceWaveform
          isRecording={isRecording}
          analyserNode={analyserNode}
        />
      )}

      {/* Transcribing spinner */}
      {phase === "transcribing" && (
        <div className="flex items-center gap-2 text-xs font-mono text-terminal-muted">
          <Loader2Icon className="size-3 animate-spin" />
          <span>Transcribing...</span>
        </div>
      )}

      {/* Action buttons during recording */}
      {phase === "recording" && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-7 px-2 text-xs font-mono text-terminal-muted"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onStopRecording}
            className="h-7 px-2 text-xs font-mono bg-red-600 hover:bg-red-700 text-white"
          >
            Stop & Send
          </Button>
        </div>
      )}
    </div>
  );
};
