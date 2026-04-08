/**
 * Design Library — Provider Integration
 *
 * Bridges the design generation/edit pipeline to Selene's existing LLM
 * provider system. Resolves the active provider and model via loadSettings()
 * and getLanguageModel(), then converts Vercel AI SDK streamText output into
 * the design pipeline's StreamEvent async generator.
 */

import { streamText } from "ai";
import {
  getConfiguredProvider,
  getConfiguredModel,
  getLanguageModelForProvider,
  resolveModelForProvider,
  DEFAULT_MODELS,
} from "@/lib/ai/providers";
import type { LLMProvider } from "@/lib/ai/providers";
import type { StreamEvent } from "./types";

// -- Public streaming entry point ------------------------------------------

export interface ImageContentPart {
  base64Data: string;
  mediaType: string;
  label?: string;
}

export interface StreamDesignOpts {
  systemPrompt: string;
  userPrompt: string;
  /** Optional multimodal image parts to include in the user message. */
  imageContentParts?: ImageContentPart[];
  /** Override the model resolved from settings. Passed through to getLanguageModel(). */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** AbortSignal for cancelling mid-stream */
  abortSignal?: AbortSignal;
}

/**
 * Stream a design-generation (or edit) completion through Selene's configured
 * LLM provider. Yields `StreamEvent` objects that the caller can forward to
 * the client over SSE / ReadableStream / WebSocket.
 *
 * Usage:
 * ```ts
 * for await (const event of streamDesignGeneration({ systemPrompt, userPrompt })) {
 *   if (event.type === "delta") process.stdout.write(event.content ?? "");
 * }
 * ```
 */
export async function* streamDesignGeneration(
  opts: StreamDesignOpts,
): AsyncGenerator<StreamEvent> {
  const { systemPrompt, userPrompt, imageContentParts, model, temperature = 0.4, maxTokens, abortSignal } = opts;

  const provider = getConfiguredProvider();
  // Kimi K2.5 requires temperature=1 (fixed value)
  const resolvedTemperature = provider === "kimi" ? 1 : temperature;

  let languageModel;
  try {
    const resolvedModel =
      resolveModelForProvider(
        model || getConfiguredModel(),
        provider,
        DEFAULT_MODELS[provider],
        "model"
      ) || DEFAULT_MODELS[provider];
    languageModel = getLanguageModelForProvider(provider, resolvedModel);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to resolve language model";
    yield {
      type: "error",
      error: { code: "PROVIDER_INIT_FAILED", message },
    };
    return;
  }

  yield {
    type: "start",
    metadata: {
      provider,
      model: model ?? "default",
      temperature: resolvedTemperature,
    },
  };

  try {
    // Build user message: multimodal when image parts are present, plain text otherwise
    const userContent: string | Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType: string }> =
      imageContentParts?.length
        ? [
            { type: "text" as const, text: userPrompt },
            ...imageContentParts.map(img => ({
              type: "image" as const,
              image: img.base64Data,
              mimeType: img.mediaType,
            })),
          ]
        : userPrompt;

    const result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      temperature: resolvedTemperature,
      ...(maxTokens ? { maxTokens } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    let fullContent = "";

    for await (const chunk of result.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    yield {
      type: "complete",
      content: fullContent,
      metadata: {
        provider,
        model: model ?? "default",
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Stream failed unexpectedly";

    // Classify common failure modes
    let code = "STREAM_ERROR";
    if (message.includes("authentication") || message.includes("API key")) {
      code = "AUTH_ERROR";
    } else if (message.includes("rate") || message.includes("429")) {
      code = "RATE_LIMITED";
    } else if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      code = "TIMEOUT";
    } else if (message.includes("abort") || message.includes("cancel")) {
      code = "ABORTED";
    }

    yield { type: "error", error: { code, message } };
  }
}

// -- Convenience: collect full response ------------------------------------

/**
 * Run a design generation to completion and return the full text.
 * Throws on error events.
 */
export async function generateDesignText(
  opts: StreamDesignOpts,
): Promise<string> {
  for await (const event of streamDesignGeneration(opts)) {
    if (event.type === "complete") {
      return event.content;
    }
    if (event.type === "error") {
      throw new Error(`[${event.error.code}] ${event.error.message}`);
    }
  }
  throw new Error("Design generation stream ended without a complete event");
}
