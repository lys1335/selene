"use client";

import { refineTranscript } from "@/lib/audio/refine-transcript";
import { resilientFetch } from "@/lib/utils/resilient-fetch";

const PREFERRED_SPEECH_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

function getSpeechRecordingExtension(mimeType: string): string {
  return mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("mp4") || mimeType.includes("m4a")
        ? "m4a"
        : "webm";
}

interface BrowserVoiceTranscriptionResult {
  transcript: string;
  finalText: string;
  fallbackText: string;
  usedPostProcessing: boolean;
}

interface TranscribeRecordedSpeechOptions {
  audioBlob: Blob;
  mimeType: string;
  postProcessingEnabled: boolean;
  signal?: AbortSignal;
  transcriptionFailedMessage: string;
  noSpeechDetectedMessage: string;
  onPostProcessingFallback?: () => void;
}

export function createSpeechMediaRecorder(stream: MediaStream): MediaRecorder {
  const supportedMimeType = PREFERRED_SPEECH_MIME_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType)
  );

  return supportedMimeType
    ? new MediaRecorder(stream, { mimeType: supportedMimeType })
    : new MediaRecorder(stream);
}

export async function transcribeRecordedSpeech({
  audioBlob,
  mimeType,
  postProcessingEnabled,
  signal,
  transcriptionFailedMessage,
  noSpeechDetectedMessage,
  onPostProcessingFallback,
}: TranscribeRecordedSpeechOptions): Promise<BrowserVoiceTranscriptionResult> {
  const formData = new FormData();
  formData.append("file", audioBlob, `voice-input.${getSpeechRecordingExtension(mimeType)}`);

  const { data: payload, error: fetchError, timedOut } = await resilientFetch<{
    text?: string;
    error?: string;
  }>("/api/voice/transcribe", {
    method: "POST",
    body: formData,
    signal,
    timeout: 30_000, // 30s for audio uploads
    retries: 2,
    onRetry: (attempt) => {
      console.warn(`[Voice STT] Transcription retry attempt ${attempt}`);
    },
  });

  if (fetchError || timedOut) {
    throw new Error(
      timedOut
        ? "Transcription timed out — please try again"
        : fetchError || transcriptionFailedMessage
    );
  }

  const transcript =
    typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!transcript) {
    throw new Error(noSpeechDetectedMessage);
  }

  const refined = await refineTranscript({
    rawTranscript: transcript,
    postProcessingEnabled,
    signal,
    onFailure: onPostProcessingFallback,
  });

  return {
    transcript: refined.rawText,
    finalText: refined.finalText,
    fallbackText: refined.rawText,
    usedPostProcessing: refined.wasEnhanced,
  };
}
