"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { type MiniOverlayPhase, getElectronAPI } from "@/lib/electron/types";
import {
  createSpeechMediaRecorder,
  transcribeRecordedSpeech,
} from "@/lib/voice/browser-stt";
import { formatTextForTTS } from "@/lib/voice/format-tts-text";

type MiniPipelinePhase = MiniOverlayPhase;

interface OverlaySessionUpdatePayload {
  sessionId?: string;
  characterId?: string;
}

function notifyOverlaySessionUpdated(payload: OverlaySessionUpdatePayload): void {
  try {
    const api = getElectronAPI();
    if (api?.ipc?.send) {
      api.ipc.send("mini-overlay:message-sent", payload);
    }
  } catch {}
}

function extractAssistantTextFromStreamChunk(chunk: string): string {
  let text = "";

  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Legacy AI SDK text stream chunks.
    if (line.startsWith("0:")) {
      try {
        text += JSON.parse(line.slice(2)) as string;
      } catch {}
      continue;
    }

    // UI message stream SSE payloads.
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as
        | { type?: string; delta?: string; errorText?: string }
        | Array<{ type?: string; delta?: string; errorText?: string }>;
      const parts = Array.isArray(parsed) ? parsed : [parsed];

      for (const part of parts) {
        if (part?.type === "text-delta" && typeof part.delta === "string") {
          text += part.delta;
        }
      }
    } catch {}
  }

  return text;
}

interface UseMiniPipelineOptions {
  sessionId?: string;
  characterId?: string;
  screenshotUrl?: string;
  /** Additional screenshots captured while the overlay is active (via Cmd+Shift+S). */
  screenshotUrls?: string[];
  autoStart?: boolean;
  mode?: "direct" | "compose";
  voicePostProcessing?: boolean;
  ttsReadCodeBlocks?: boolean;
  onError?: (error: string) => void;
  onComposeReady?: (payload: { transcript: string; screenshotUrl?: string; screenshotUrls?: string[]; characterId?: string; sessionId?: string }) => void;
}

interface UseMiniPipelineReturn {
  phase: MiniPipelinePhase;
  transcript: string;
  response: string;
  error: string;
  analyserNode: AnalyserNode | null;
  shouldAutoClose: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancel: () => void;
  /** Compose mode: user confirms handoff to main app. */
  confirmCompose: () => void;
  /** Direct mode: stop TTS playback early but keep the response visible. */
  stopSpeaking: () => void;
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
    ttsReadCodeBlocks = false,
    onError,
    onComposeReady,
  } = options;

  const [phase, setPhase] = useState<MiniPipelinePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [shouldAutoClose, setShouldAutoClose] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Separate abort controllers for each pipeline stage so cancellation is precise
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRejectRef = useRef<((reason?: unknown) => void) | null>(null);
  const cancelledRef = useRef(false);
  const speechStopRequestedRef = useRef(false);
  const modeRef = useRef(mode);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Keep refs in sync so the recorder.onstop closure always sees the latest values
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const characterIdRef = useRef(characterId);
  useEffect(() => { characterIdRef.current = characterId; }, [characterId]);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
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
    speechStopRequestedRef.current = false;
    // Discard any buffered audio chunks so that even if the onstop handler
    // somehow runs past the cancelledRef guard, it produces an empty blob.
    chunksRef.current = [];
    stopAllStreams();
    setPhase("idle");
    setTranscript("");
    setResponse("");
    setError("");
    setShouldAutoClose(true);
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
    const currentCharacterId = characterIdRef.current;
    const currentSessionId = sessionIdRef.current;
    if (!currentCharacterId && !currentSessionId) {
      const msg = "No overlay chat target selected";
      setError(msg);
      setPhase("error");
      onError?.(msg);
      return;
    }
    const allScreenshots = [
      ...(screenshotUrl ? [screenshotUrl] : []),
      ...(currentScreenshotUrls ?? []),
    ];
    onComposeReady?.({
      transcript,
      screenshotUrl: allScreenshots[0],
      screenshotUrls: allScreenshots.length > 0 ? allScreenshots : undefined,
      characterId: currentCharacterId,
      sessionId: currentSessionId,
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
  }, [phase, transcript, screenshotUrl, onComposeReady]);

  const startRecording = useCallback(async () => {
    cancelledRef.current = false;
    speechStopRequestedRef.current = false;
    chunksRef.current = [];
    setTranscript("");
    setResponse("");
    setError("");
    setShouldAutoClose(true);

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

      const recorder = createSpeechMediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && !cancelledRef.current) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (cancelledRef.current) return;

        // Returns true when the pipeline should abort (either cancelled or error set).
        const failPipeline = (err: unknown): boolean => {
          if (cancelledRef.current) return true;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setPhase("error");
          onError?.(msg);
          return true;
        };

        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        // Validate WebM EBML header to catch corrupted blobs early
        if (mimeType.includes("webm") && blob.size >= 4) {
          const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
          if (header[0] !== 0x1A || header[1] !== 0x45 || header[2] !== 0xDF || header[3] !== 0xA3) {
            console.warn("[Voice] Invalid WebM EBML header detected, blob may be corrupted");
          }
        }

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
        let finalTranscript = "";
        try {
          const result = await transcribeRecordedSpeech({
            audioBlob: blob,
            mimeType,
            postProcessingEnabled: voicePostProcessing,
            signal: transcribeAbortRef.current.signal,
            transcriptionFailedMessage: "Transcription failed",
            noSpeechDetectedMessage: "No speech detected",
          });
          rawTranscript = result.transcript;
          finalTranscript = result.finalText;
        } catch (err: unknown) {
          if (failPipeline(err)) return;
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

        // --- Resolve session (reuse existing session unless user explicitly starts a new one) ---
        const currentCharacterId = characterIdRef.current;
        let resolvedSessionId = sessionIdRef.current;
        if (!currentCharacterId && !resolvedSessionId) {
          const msg = "No overlay chat target selected";
          setError(msg);
          setPhase("error");
          onError?.(msg);
          return;
        }
        if (currentCharacterId) {
          try {
            const resolveRes = await fetch("/api/overlay/resolve-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ characterId: currentCharacterId, sessionId: resolvedSessionId }),
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
          if (currentCharacterId) {
            chatBody.characterId = currentCharacterId;
          }

          const chatHeaders: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (resolvedSessionId) {
            chatHeaders["X-Session-Id"] = resolvedSessionId;
          }
          if (currentCharacterId) {
            chatHeaders["X-Character-Id"] = currentCharacterId;
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

          notifyOverlaySessionUpdated({
            sessionId: resolvedSessionId,
            characterId: currentCharacterId,
          });

          const reader = chatRes.body?.getReader();
          if (!reader) {
            throw new Error("Chat failed: empty response body");
          }
          try {
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (cancelledRef.current) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              if (lines.length > 0) {
                accumulated += extractAssistantTextFromStreamChunk(lines.join("\n"));
              }
            }

            buffer += decoder.decode();
            if (buffer) {
              accumulated += extractAssistantTextFromStreamChunk(buffer);
            }
          } finally {
            reader.releaseLock();
          }
        } catch (err: unknown) {
          if (failPipeline(err)) return;
        }

        if (cancelledRef.current) return;
        setResponse(accumulated);

        // Notify the main window even if the assistant response is empty so the
        // persisted session still becomes visible in the app.
        notifyOverlaySessionUpdated({
          sessionId: resolvedSessionId,
          characterId: currentCharacterId,
        });

        if (!accumulated.trim()) {
          setPhase("done");
          return;
        }

        const ttsText = formatTextForTTS(accumulated, ttsReadCodeBlocks);
        if (!ttsText) {
          setPhase("done");
          return;
        }

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
          if (speechStopRequestedRef.current) {
            setShouldAutoClose(false);
            setPhase("done");
            return;
          }

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
          if (speechStopRequestedRef.current) {
            setShouldAutoClose(false);
            setPhase("done");
            return;
          }
          // Non-fatal: TTS failure still shows "done"
        }

        if (cancelledRef.current) return;
        // Direct mode: enter done phase. The page controls close/dismiss behavior.
        setShouldAutoClose(true);
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

      // No timeslice — collect a single complete blob on stop.
      // Using timeslice causes Chromium's WebM muxer to produce invalid
      // headers on second recordings within the same session (Whisper 400).
      recorder.start();
      setPhase("recording");
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
      onError?.(msg);
    }
  }, [screenshotUrl, ttsReadCodeBlocks, voicePostProcessing, onError]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    speechStopRequestedRef.current = true;
    setShouldAutoClose(false);
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsAudioRejectRef.current) {
      ttsAudioRejectRef.current(new Error("stopped"));
      ttsAudioRejectRef.current = null;
    }
    setPhase("done");
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
    shouldAutoClose,
    startRecording,
    stopRecording,
    cancel,
    confirmCompose,
    stopSpeaking,
  };
}
