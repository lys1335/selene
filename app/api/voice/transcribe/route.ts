import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { isAudioMimeType, transcribeAudio } from "@/lib/audio/transcription";
import { saveTranscriptionToHistory } from "@/lib/voice/voice-utils";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Detect audio MIME type from buffer magic bytes.
 * More reliable than trusting the Content-Type header, especially when
 * Chromium's MediaRecorder produces blobs with mismatched headers.
 */
function detectAudioMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // WebM (EBML header): 0x1A 0x45 0xDF 0xA3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return "audio/webm";
  }
  // OGG: "OggS"
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return "audio/ogg";
  }
  // FLAC: "fLaC"
  if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return "audio/flac";
  }
  // WAV: "RIFF"
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return "audio/wav";
  }
  // MP3: ID3 tag or sync word
  if ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // "ID3"
      (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0)) { // sync word
    return "audio/mpeg";
  }
  // MP4/M4A: check for ftyp box
  if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return "audio/mp4";
  }

  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(req);

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
    }

    if (!file.size) {
      return NextResponse.json({ error: "Uploaded audio file is empty" }, { status: 400 });
    }

    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio file exceeds 25MB limit" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Detect actual format from magic bytes instead of trusting Content-Type
    const detectedMime = detectAudioMimeFromBuffer(buffer) || file.type || "audio/webm";
    const mimeType = detectedMime;

    if (!isAudioMimeType(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported audio format: ${mimeType || "unknown"}`, code: "UNSUPPORTED_FORMAT" },
        { status: 400 }
      );
    }

    // Validate that declared MIME matches actual content (catches corrupted blobs)
    if (file.type && detectedMime && file.type !== detectedMime) {
      console.warn(
        `[Voice API] MIME mismatch: declared=${file.type}, detected=${detectedMime}. Using detected type.`
      );
    }

    const result = await transcribeAudio(buffer, mimeType, file.name || undefined);

    // Save to voice history (fire-and-forget, non-blocking)
    void saveTranscriptionToHistory({
      provider: result.provider,
      text: result.text,
      language: result.language ?? null,
      durationMs: result.durationSeconds != null ? Math.round(result.durationSeconds * 1000) : null,
    }).catch((err) => {
      console.error("[Voice API] Failed to save transcription to history:", err);
    });

    return NextResponse.json({
      success: true,
      text: result.text,
      provider: result.provider,
      durationSeconds: result.durationSeconds,
      language: result.language,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to transcribe audio";

    // Classify errors by code for structured client-side handling
    const USER_FIXABLE_PATTERNS = [
      "disabled", "No API key", "Unsupported STT provider",
      "Settings -> Voice & Audio", "could not find ffmpeg",
      "whisper-cli not found", "model \"", "Please download it in Settings",
    ];
    const isUserFixable = USER_FIXABLE_PATTERNS.some((p) => message.includes(p));
    const isFormatError = message.includes("Invalid file format") || message.includes("format");

    const code = isUserFixable ? "CONFIG_ERROR" : isFormatError ? "FORMAT_ERROR" : "TRANSCRIPTION_ERROR";
    const status = isUserFixable ? 400 : 500;

    console.error("[Voice API] Transcribe failed:", error);
    return NextResponse.json({ error: message, code }, { status });
  }
}
