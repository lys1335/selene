"use client";

import { refineTranscript } from "@/lib/audio/refine-transcript";

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

export interface BrowserVoiceTranscriptionResult {
  transcript: string;
  finalText: string;
  fallbackText: string;
  usedPostProcessing: boolean;
}

export interface TranscribeRecordedSpeechOptions {
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

  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    body: formData,
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || transcriptionFailedMessage);
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
