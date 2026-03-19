"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { type MiniOverlayPhase, getElectronAPI } from "@/lib/electron/types";
import { refineTranscript } from "@/lib/audio/refine-transcript";

// Re-export for convenience
export type { MiniOverlayPhase };
export type MiniPipelinePhase = MiniOverlayPhase;

interface UseMiniPipelineOptions {
  sessionId?: string;
  characterId?: string;
  screenshotUrl?: string;
  /** Additional screenshots captured while the overlay is active (via Cmd+Shift+S). */
  screenshotUrls?: string[];
  autoStart?: boolean;
  mode?: "direct" | "compose";
  voicePostProcessing?: boolean;
  onError?: (error: string) => void;
  onComposeReady?: (payload: { transcript: string; screenshotUrl?: string; screenshotUrls?: string[]; characterId?: string; sessionId?: string }) => void;
}

interface UseMiniPipelineReturn {
  phase: MiniPipelinePhase;
  transcript: string;
  response: string;
  error: string;
  analyserNode: AnalyserNode | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancel: () => void;
  /** Compose mode: user confirms handoff to main app. */
  confirmCompose: () => void;
}

export function useMiniPipeline(options: UseMiniPipelineOptions): UseMiniPipelineReturn {
  const {
    sessionId,
    characterId,
    screenshotUrl,
    screenshotUrls,
    autoStart,
    mode = "direct",
    voicePostProcessing = true,
    onError,
    onComposeReady,
  } = options;

  const [phase, setPhase] = useState<MiniPipelinePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Separate abort controllers for each pipeline stage so cancellation is precise
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRejectRef = useRef<((reason?: unknown) => void) | null>(null);
  const cancelledRef = useRef(false);
  const modeRef = useRef(mode);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Keep refs in sync so the recorder.onstop closure always sees the latest values
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const screenshotUrlsRef = useRef(screenshotUrls);
  useEffect(() => { screenshotUrlsRef.current = screenshotUrls; }, [screenshotUrls]);

  const stopAllStreams = useCallback(() => {
    // Stop media stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Stop media recorder (cancelledRef should already be set by caller)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    // Stop TTS audio and reject its promise so it doesn't hang
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsAudioRejectRef.current) {
      ttsAudioRejectRef.current(new Error("cancelled"));
      ttsAudioRejectRef.current = null;
    }
    // Revoke any outstanding object URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    // Abort all in-flight fetches
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    refineAbortRef.current?.abort();
    refineAbortRef.current = null;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    // Clear done timer
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    setAnalyserNode(null);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    // Discard any buffered audio chunks so that even if the onstop handler
    // somehow runs past the cancelledRef guard, it produces an empty blob.
    chunksRef.current = [];
    stopAllStreams();
    setPhase("idle");
    setTranscript("");
    setResponse("");
    setError("");
  }, [stopAllStreams]);

  // -------------------------------------------------------------------------
  // confirmCompose — called by the page when user clicks "Open in Selene"
  // while in compose-review phase.
  // -------------------------------------------------------------------------
  const confirmCompose = useCallback(() => {
    if (cancelledRef.current) return;
    // Only allow confirmCompose from the compose-review phase
    if (phase !== "compose-review") return;
    setPhase("compose-pending");
    const currentScreenshotUrls = screenshotUrlsRef.current;
    const allScreenshots = [
      ...(screenshotUrl ? [screenshotUrl] : []),
      ...(currentScreenshotUrls ?? []),
    ];
    onComposeReady?.({
      transcript,
      screenshotUrl: allScreenshots[0],
      screenshotUrls: allScreenshots.length > 0 ? allScreenshots : undefined,
      characterId,
      sessionId,
    });
    // Brief "compose-pending" display, then move to done.
    // The page controls when to actually close the overlay.
    // Clear any previous timer to prevent double-fire on rapid clicks.
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
    }
    doneTimerRef.current = setTimeout(() => {
      doneTimerRef.current = null;
      if (!cancelledRef.current) {
        setPhase("done");
      }
    }, 500);
  }, [phase, transcript, screenshotUrl, characterId, sessionId, onComposeReady]);

  const startRecording = useCallback(async () => {
    cancelledRef.current = false;
    chunksRef.current = [];
    setTranscript("");
    setResponse("");
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const ac = new AudioContext();
      audioContextRef.current = ac;
      const source = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setAnalyserNode(analyser);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/wav";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && !cancelledRef.current) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (cancelledRef.current) return;

        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        // Stop stream tracks now that recording is done
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        setAnalyserNode(null);

        setPhase("transcribing");

        // --- Transcribe ---
        transcribeAbortRef.current = new AbortController();
        let rawTranscript = "";
        try {
          const formData = new FormData();
          formData.append("file", blob, "recording.webm");
          const transcribeRes = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: formData,
            signal: transcribeAbortRef.current.signal,
          });
          if (!transcribeRes.ok) throw new Error(`Transcription failed: ${transcribeRes.status}`);
          const transcribeData = await transcribeRes.json();
          rawTranscript = transcribeData.transcript ?? transcribeData.text ?? "";
        } catch (err: unknown) {
          if (cancelledRef.current) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setPhase("error");
          onError?.(msg);
          return;
        }

        if (cancelledRef.current) return;

        // --- Refine (voice post-processing) ---
        let finalTranscript = rawTranscript;
        if (voicePostProcessing && rawTranscript.length > 0) {
          setPhase("refining");
          refineAbortRef.current = new AbortController();
          try {
            const result = await refineTranscript({
              rawTranscript,
              postProcessingEnabled: true,
              signal: refineAbortRef.current.signal,
            });
            finalTranscript = result.finalText;
          } catch {
            // Refinement failed — use raw transcript
            if (cancelledRef.current) return;
          }
        }

        if (cancelledRef.current) return;
        setTranscript(finalTranscript);

        // --- Compose mode: pause at compose-review for user confirmation ---
        if (modeRef.current === "compose") {
          setPhase("compose-review");
          // Stop here. The user will click "Open in Selene" to trigger
          // confirmCompose(), which calls onComposeReady and transitions
          // to compose-pending → done.
          return;
        }

        // --- Direct mode: continue to chat + TTS ---
        setPhase("thinking");

        // --- Resolve session (24h window) ---
        let resolvedSessionId = sessionId;
        if (characterId) {
          try {
            const resolveRes = await fetch("/api/overlay/resolve-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ characterId }),
            });
            if (resolveRes.ok) {
              const resolved = await resolveRes.json();
              resolvedSessionId = resolved.sessionId;
            }
          } catch {}
        }
        if (cancelledRef.current) return;

        // --- Chat ---
        chatAbortRef.current = new AbortController();
        let accumulated = "";
        try {
          // Combine initial screenshot with any additional ones captured during recording
          const currentExtraUrls = screenshotUrlsRef.current;
          const allScreenshots = [
            ...(screenshotUrl ? [screenshotUrl] : []),
            ...(currentExtraUrls ?? []),
          ];
          const screenshotAttachments = allScreenshots.map((url, i) => ({
            name: `screenshot-${i + 1}.png`,
            contentType: "image/png",
            url,
          }));
          const chatBody: Record<string, unknown> = {
            sessionId: resolvedSessionId,
            messages: [
              {
                role: "user",
                content: finalTranscript,
                ...(screenshotAttachments.length > 0
                  ? { experimental_attachments: screenshotAttachments }
                  : {}),
              },
            ],
          };
          if (characterId) {
            chatBody.characterId = characterId;
          }

          const chatHeaders: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (resolvedSessionId) {
            chatHeaders["X-Session-Id"] = resolvedSessionId;
          }
          if (characterId) {
            chatHeaders["X-Character-Id"] = characterId;
          }

          const chatRes = await fetch("/api/chat", {
            method: "POST",
            headers: chatHeaders,
            body: JSON.stringify(chatBody),
            signal: chatAbortRef.current.signal,
          });
          if (!chatRes.ok) {
            let detail = `${chatRes.status}`;
            try {
              const errBody = await chatRes.json();
              if (errBody?.error) detail = errBody.error;
            } catch {}
            throw new Error(`Chat failed: ${detail}`);
          }

          const reader = chatRes.body!.getReader();
          try {
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (cancelledRef.current) break;
              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split("\n")) {
                if (line.startsWith("0:")) {
                  try {
                    accumulated += JSON.parse(line.slice(2));
                  } catch {}
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        } catch (err: unknown) {
          if (cancelledRef.current) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setPhase("error");
          onError?.(msg);
          return;
        }

        if (cancelledRef.current) return;
        setResponse(accumulated);

        // Notify main window that a message was sent via the overlay
        try {
          const api = getElectronAPI();
          if (api?.ipc?.send) {
            api.ipc.send("mini-overlay:message-sent", { sessionId: resolvedSessionId, characterId });
          }
        } catch {}

        setPhase("speaking");

        // --- TTS ---
        ttsAbortRef.current = new AbortController();
        try {
          const ttsRes = await fetch("/api/voice/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: accumulated }),
            signal: ttsAbortRef.current.signal,
          });
          if (!ttsRes.ok) throw new Error(`TTS failed: ${ttsRes.status}`);

          const audioBlob = await ttsRes.blob();
          if (cancelledRef.current) return;

          const audioUrl = URL.createObjectURL(audioBlob);
          objectUrlRef.current = audioUrl;
          try {
            const audio = new Audio(audioUrl);
            ttsAudioRef.current = audio;

            await new Promise<void>((resolve, reject) => {
              ttsAudioRejectRef.current = reject;
              audio.onended = () => resolve();
              audio.onerror = () => reject(new Error("Audio playback error"));
              audio.play().catch(reject);
            });
          } finally {
            // Always revoke object URL
            URL.revokeObjectURL(audioUrl);
            objectUrlRef.current = null;
            ttsAudioRef.current = null;
            ttsAudioRejectRef.current = null;
          }
        } catch (err: unknown) {
          if (cancelledRef.current) return;
          // Non-fatal: TTS failure still shows "done"
        }

        if (cancelledRef.current) return;
        // Direct mode: enter done phase. The page controls close/dismiss behavior.
        // No auto-close timer — the user or settings determine when to close.
        setPhase("done");
      };

      // If cancel was called while we were setting up the recorder (between
      // getUserMedia resolving and here), bail before starting. stopAllStreams()
      // would have found mediaRecorderRef still null, so the recorder was never
      // stopped — we must clean it up ourselves.
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        ac.close().catch(() => {});
        mediaRecorderRef.current = null;
        audioContextRef.current = null;
        streamRef.current = null;
        setAnalyserNode(null);
        return;
      }

      // Request data every 250ms to avoid holding entire recording in memory
      recorder.start(250);
      setPhase("recording");
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
      onError?.(msg);
    }
  }, [sessionId, characterId, screenshotUrl, mode, voicePostProcessing, onError]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // autoStart — use a ref to ensure recording starts exactly once, even if
  // startRecording's identity changes (e.g., when the agent picker resolves async)
  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || hasAutoStartedRef.current) return;
    hasAutoStartedRef.current = true;
    // Start immediately — no delay. The user expects instant visual feedback.
    startRecording();
  }, [autoStart, startRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopAllStreams();
    };
  }, [stopAllStreams]);

  return {
    phase,
    transcript,
    response,
    error,
    analyserNode,
    startRecording,
    stopRecording,
    cancel,
    confirmCompose,
  };
}
