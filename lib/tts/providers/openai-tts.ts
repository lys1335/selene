import { loadSettings } from "@/lib/settings/settings-manager";
import type { TTSOptions, TTSProvider, TTSResult } from "../types";

export class OpenAITTSProvider implements TTSProvider {
  name = "openai";

  isAvailable(): boolean {
    const settings = loadSettings();
    return !!(settings.openaiApiKey || process.env.OPENAI_API_KEY);
  }

  async synthesize(options: TTSOptions): Promise<TTSResult> {
    const settings = loadSettings();
    const apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("No OpenAI API key configured for OpenAI TTS");
    }

    const baseUrl = "https://api.openai.com/v1";

    const model = settings.openaiTtsModel || "gpt-4o-mini-tts";
    const voice = options.voice || settings.openaiTtsVoice || "alloy";

    // Request Opus natively for Telegram (avoids ffmpeg conversion step)
    const wantsOpus = options.channelHint === "telegram";
    const responseFormat = wantsOpus ? "opus" : "mp3";

    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: options.text,
        voice,
        speed: options.speed ?? 1.0,
        response_format: responseFormat,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS API error ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuffer),
      mimeType: wantsOpus ? "audio/ogg" : "audio/mpeg",
    };
  }
}
