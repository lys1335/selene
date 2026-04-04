"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Mic, Brain, Volume2, Square, Check, AlertCircle, Loader2, ArrowUp, Copy } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { MiniOverlayPhase } from "@/lib/electron/types";

interface RecordingPillProps {
  phase: MiniOverlayPhase;
  transcript?: string;
  response?: string;
  error?: string;
  analyserNode?: AnalyserNode | null;
  onCancel: () => void;
  onClose: () => void;
  /** Called when the user clicks the Send button during recording. */
  onStopRecording?: () => void;
  /** Optional slot rendered at the top of the pill, above the phase content. */
  agentPicker?: ReactNode;
  /** Optional slot rendered at the bottom of the pill, below the cancel button. */
  modeToggle?: ReactNode;
  /** Screenshot context for the current session — shown as small thumbnails. */
  screenshotUrls?: string[];
  /** Called when the user clicks "Open in Selene" in compose-review phase. */
  onConfirmCompose?: () => void;
  /** Called when the user clicks "Close" in done phase. */
  onDismiss?: () => void;
  /** Called when the user clicks the stop-audio button during speaking phase. */
  onStopSpeaking?: () => void;
}

export function RecordingPill({
  phase,
  transcript,
  response,
  error,
  analyserNode,
  onCancel,
  onClose,
  onStopRecording,
  agentPicker,
  modeToggle,
  screenshotUrls,
  onConfirmCompose,
  onDismiss,
  onStopSpeaking,
}: RecordingPillProps) {
  const t = useTranslations("miniOverlay.recordingPill");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resolvedWaveformColor, setResolvedWaveformColor] = useState("#C2714F");
  const [showFullScreenshot, setShowFullScreenshot] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (text: string) => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 1500);
    } catch {
      // Ignore clipboard failures in constrained renderer contexts.
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  // Keep the recording waveform on a stable accent so it stays visible in both light and dark themes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const style = getComputedStyle(document.documentElement);
    const raw = style.getPropertyValue("--accent").trim();
    if (raw) {
      setResolvedWaveformColor(`hsl(${raw})`);
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
    const fillColor = resolvedWaveformColor;
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
  }, [phase, analyserNode, resolvedWaveformColor]);

  const responsePanel = response ? (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-2">
      <div className="max-h-[88px] w-full overflow-y-auto rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        <p className="whitespace-pre-wrap break-words text-center">{response}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void handleCopy(response);
        }}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  ) : null;

  const renderContent = () => {
    switch (phase) {
      case "recording":
        return (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-foreground">{t("listening")}</span>
            </div>
            <canvas
              ref={canvasRef}
              width={160}
              height={40}
              className="block"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStopRecording?.();
              }}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              style={{
                // @ts-ignore
                WebkitAppRegion: "no-drag",
              }}
            >
              <ArrowUp className="h-3 w-3" />
              {t("send")}
              <kbd className="ml-1 text-[10px] opacity-70">⌘⇧A</kbd>
            </button>
          </div>
        );

      case "transcribing":
        return (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("transcribing")}</span>
          </div>
        );

      case "refining":
        return (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("refining")}</span>
          </div>
        );

      case "thinking":
        return (
          <div className="flex items-center gap-2 py-2">
            <Brain className="h-4 w-4 animate-pulse text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("thinking")}</span>
          </div>
        );

      case "speaking":
        return (
          <div className="flex w-full flex-col items-center gap-2 px-2 py-2">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 shrink-0 animate-pulse text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{t("speaking")}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStopSpeaking?.();
                }}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                title={t("stopAudio")}
                aria-label={t("stopAudio")}
                style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            </div>
            {responsePanel}
          </div>
        );

      case "compose-pending":
        return (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("openingComposer")}</span>
          </div>
        );

      case "compose-review":
        return (
          <div className="flex w-full flex-col items-center gap-3 px-2 py-2">
            {transcript && (
              <p className="max-w-[380px] text-center text-xs text-muted-foreground line-clamp-3">
                {transcript}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmCompose?.();
                }}
                className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                style={{
                  // @ts-ignore
                  WebkitAppRegion: "no-drag",
                }}
              >
                {t("openInSelene")}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                style={{
                  // @ts-ignore
                  WebkitAppRegion: "no-drag",
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        );

      case "done":
        return (
          <div className="flex w-full flex-col items-center gap-2 px-2 py-2">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-foreground">{t("done")}</span>
            </div>
            {responsePanel}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss?.();
              }}
              className="rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              style={{
                // @ts-ignore
                WebkitAppRegion: "no-drag",
              }}
            >
              {t("close")}
            </button>
          </div>
        );

      case "error":
        return (
          <div className="flex items-center gap-2 px-2 py-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <span className="text-sm text-red-500 line-clamp-2">{error ?? t("errorDefault")}</span>
          </div>
        );

      case "idle":
      default:
        return (
          <div className="flex items-center gap-2 py-2">
            <Mic className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("ready")}</span>
          </div>
        );
    }
  };

  return (
    <div
      className="relative flex h-full w-full flex-col items-center overflow-hidden"
      style={{
        // @ts-ignore
        WebkitAppRegion: "drag",
      }}
    >
      <div
        className="absolute right-2 top-2 z-10 flex items-center gap-1.5"
        style={{
          // @ts-ignore
          WebkitAppRegion: "no-drag",
        }}
      >
        {screenshotUrls && screenshotUrls.length > 0 && (
          <div className="flex max-w-[200px] items-center gap-1.5 overflow-x-auto">
            {screenshotUrls.map((url, i) => (
              <button
                key={`${url}-${i}`}
                onClick={() => setShowFullScreenshot(url)}
                className="group relative shrink-0"
                title={t("viewFullScreenshot")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Screenshot ${i + 1}`}
                  className="h-10 w-14 rounded object-cover border border-border/40 transition-colors group-hover:border-primary/60"
                />
                <span className="absolute inset-0 flex items-center justify-center rounded bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                  <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                </span>
              </button>
            ))}
          </div>
        )}
        <span className="whitespace-nowrap text-[10px] text-muted-foreground/60">{"\u2318\u21E7S"} {t("addScreenshot")}</span>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label={t("close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {agentPicker && (
        <div className="flex w-full items-center px-3 pt-2">
          {agentPicker}
        </div>
      )}

      <div className="flex flex-1 items-center justify-center w-full px-10 pt-4 pb-2">
        {renderContent()}
      </div>

      {phase !== "done" && phase !== "error" && phase !== "compose-review" && (
        <div
          className="pb-2"
          style={{
            // @ts-ignore
            WebkitAppRegion: "no-drag",
          }}
        >
          <button
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("cancel")}
          </button>
        </div>
      )}

      {modeToggle && (
        <div
          className="flex w-full items-center justify-center px-3 pb-3"
          style={{
            // @ts-ignore
            WebkitAppRegion: "no-drag",
          }}
        >
          {modeToggle}
        </div>
      )}

      {showFullScreenshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setShowFullScreenshot(null)}
          style={{
            // @ts-ignore
            WebkitAppRegion: "no-drag",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={showFullScreenshot}
            alt="Full screenshot"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setShowFullScreenshot(null)}
            className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
