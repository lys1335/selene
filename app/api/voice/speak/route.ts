import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { isTTSAvailable, synthesizeSpeech } from "@/lib/tts/manager";
import { loadSettings } from "@/lib/settings/settings-manager";
import { formatTextForTTS } from "@/lib/voice/format-tts-text";

interface SpeakRequestBody {
  text?: string;
  voice?: string;
  speed?: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(req);

    const body = (await req.json()) as SpeakRequestBody;
    const rawText = typeof body.text === "string" ? body.text : "";
    const settings = loadSettings();
    const text = formatTextForTTS(
      rawText,
      settings.ttsReadCodeBlocks ?? false,
      settings.ttsSpeakCodeSymbols ?? false,
    );
    const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : undefined;
    const speed = typeof body.speed === "number" ? body.speed : undefined;

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (!isTTSAvailable()) {
      return NextResponse.json(
        { error: "Text-to-speech is not enabled or configured in Settings." },
        { status: 400 }
      );
    }

    const result = await synthesizeSpeech({ text, voice, speed });
    return new NextResponse(new Uint8Array(result.audio), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType || "audio/mpeg",
        "Content-Length": String(result.audio.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to synthesize speech";
    console.error("[Voice API] Speak failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
