"use client";
import { useRef, useEffect, useState } from "react";
import { X, Mic, Brain, Volume2, Check, AlertCircle, Loader2 } from "lucide-react";
import type { MiniOverlayPhase } from "@/lib/electron/types";
import type { ReactNode } from "react";

interface RecordingPillProps {
  phase: MiniOverlayPhase;
  transcript?: string;
  response?: string;
  error?: string;
  analyserNode?: AnalyserNode | null;
  onCancel: () => void;
  onClose: () => void;
  /** Optional slot rendered at the top of the pill, above the phase content. */
  agentPicker?: ReactNode;
  /** Optional slot rendered at the bottom of the pill, below the cancel button. */
  modeToggle?: ReactNode;
}

export function RecordingPill({
  phase,
  transcript,
  response,
  error,
  analyserNode,
  onCancel,
  onClose,
  agentPicker,
  modeToggle,
}: RecordingPillProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [resolvedPrimaryColor, setResolvedPrimaryColor] = useState("#6366f1");

  // Resolve CSS variable to a concrete color for canvas rendering.
  // Canvas 2D context doesn't support CSS custom properties like "hsl(var(--primary))".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const style = getComputedStyle(document.documentElement);
    const raw = style.getPropertyValue("--primary").trim();
    if (raw) {
      setResolvedPrimaryColor(`hsl(${raw})`);
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording" || !analyserNode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animId: number;
    const fillColor = resolvedPrimaryColor;
    const draw = () => {
      animId = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barCount = 24;
      const barWidth = 3;
      const gap = 2;
      const totalWidth = barCount * (barWidth + gap) - gap;
      const startX = (canvas.width - totalWidth) / 2;
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * bufferLength);
        const value = dataArray[dataIndex] / 255;
        const barHeight = Math.max(4, value * canvas.height * 0.8);
        const x = startX + i * (barWidth + gap);
        const y = (canvas.height - barHeight) / 2;
        ctx.fillStyle = fillColor;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [phase, analyserNode, resolvedPrimaryColor]);

  const renderContent = () => {
    switch (phase) {
      case "recording":
        return (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-foreground">Listening...</span>
            </div>
            <canvas
              ref={canvasRef}
              width={160}
              height={40}
              className="block"
            />
          </div>
        );

      case "transcribing":
        return (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Transcribing...</span>
          </div>
        );

      case "thinking":
        return (
          <div className="flex items-center gap-2 py-2">
            <Brain className="h-4 w-4 animate-pulse text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Thinking...</span>
          </div>
        );

      case "speaking":
        return (
          <div className="flex flex-col items-center gap-2 py-2 px-2 w-full">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground">Speaking</span>
            </div>
            {response && (
              <p className="text-xs text-muted-foreground text-center line-clamp-2 max-w-[380px]">
                {response}
              </p>
            )}
          </div>
        );

      case "compose-pending":
        return (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Opening composer...</span>
          </div>
        );

      case "done":
        return (
          <div className="flex items-center gap-2 py-2">
            <Check className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium text-foreground">Done</span>
          </div>
        );

      case "error":
        return (
          <div className="flex items-center gap-2 py-2 px-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-sm text-red-500 line-clamp-2">{error ?? "An error occurred"}</span>
          </div>
        );

      case "idle":
      default:
        return (
          <div className="flex items-center gap-2 py-2">
            <Mic className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Ready</span>
          </div>
        );
    }
  };

  return (
    <div
      className="relative flex flex-col items-center rounded-2xl shadow-2xl backdrop-blur-xl bg-background/95 border border-border/50 overflow-hidden"
      style={{
        width: 460,
        minHeight: 80,
        // @ts-ignore
        WebkitAppRegion: "drag",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors z-10"
        style={{
          // @ts-ignore
          WebkitAppRegion: "no-drag",
        }}
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Agent picker slot — shown above phase content when provided */}
      {agentPicker && (
        <div className="w-full flex items-center px-3 pt-2">
          {agentPicker}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center w-full px-10 pt-4 pb-2">
        {renderContent()}
      </div>

      {/* Cancel button */}
      {phase !== "done" && phase !== "error" && (
        <div
          className="pb-2"
          style={{
            // @ts-ignore
            WebkitAppRegion: "no-drag",
          }}
        >
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Mode toggle slot */}
      {modeToggle && (
        <div
          className="w-full flex items-center justify-center px-3 pb-3"
          style={{
            // @ts-ignore
            WebkitAppRegion: "no-drag",
          }}
        >
          {modeToggle}
        </div>
      )}
    </div>
  );
}
