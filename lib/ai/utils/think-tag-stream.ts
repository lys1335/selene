/**
 * Think-tag streaming middleware for vLLM and legacy Ollama models.
 *
 * Models like Qwen3.5 emit chain-of-thought reasoning wrapped in
 * `<think>...</think>` tags as part of their text output. This middleware
 * intercepts those tags at the stream level and converts them into proper
 * AI SDK reasoning parts so the UI can render a collapsible "thinking"
 * section instead of leaking raw XML into the chat.
 *
 * For Ollama v0.9.0+: models that support native thinking are detected
 * via `/api/show` capabilities. Those models have their tags parsed
 * server-side by Ollama, which sends structured `delta.reasoning` that
 * the AI SDK handles natively — this middleware is skipped entirely.
 * This avoids issues with models using non-standard tag formats
 * (e.g. Gemma4's `<|channel>thought`) that the `<think>` parser can't handle.
 *
 * Implementation: delegates to the AI SDK's built-in
 * `extractReasoningMiddleware` which already handles all streaming edge
 * cases (tag split across chunks, multiple think blocks, unclosed tags on
 * stream abort, etc.).
 */

import { extractReasoningMiddleware } from "ai";
import type { LanguageModelMiddleware } from "ai";

import { isThinkTagModel } from "./think-tag-patterns";

/**
 * Language-model middleware that converts `<think>...</think>` text deltas
 * into `reasoning-start / reasoning-delta / reasoning-end` stream parts.
 *
 * Usage with `wrapLanguageModel`:
 * ```ts
 * import { wrapLanguageModel } from "ai";
 * import { thinkTagMiddleware } from "@/lib/ai/utils/think-tag-stream";
 *
 * const wrapped = wrapLanguageModel({
 *   model: vllmModel,
 *   middleware: thinkTagMiddleware,
 * });
 * ```
 *
 * Key behaviors:
 * - The first token from Qwen-style models is often `<think>\n` --
 *   `startWithReasoning: true` handles this by treating the beginning of
 *   the response as reasoning content until `</think>` is seen.
 * - If the model gets cut off mid-think (no closing tag), the buffered
 *   reasoning is still flushed when the stream ends.
 * - Only exact, case-sensitive `<think>` / `</think>` tags are matched.
 * - Content between `</think>` and a subsequent `<think>` is emitted as
 *   normal text.
 */
export const thinkTagMiddleware: LanguageModelMiddleware =
  extractReasoningMiddleware({
    tagName: "think",
    startWithReasoning: true,
    separator: "\n",
  });

/**
 * Providers that ALWAYS emit raw `<think>` tags in their text output
 * (i.e. they never provide structured reasoning via `delta.reasoning`).
 */
const ALWAYS_THINK_TAG_PROVIDERS = new Set(["vllm"]);

/**
 * Options for checking whether a provider/model emits think tags.
 */
export interface ThinkTagCheckOptions {
  provider: string;
  modelId?: string;
  ollamaSupportsThinking?: boolean;
}

/**
 * Returns `true` if the given provider is known to emit `<think>...</think>`
 * reasoning tags that should be intercepted by `thinkTagMiddleware`.
 *
 * For Ollama: returns `false` when the model supports native thinking
 * (Ollama v0.9.0+ parses tags server-side and sends structured
 * `delta.reasoning`). For models without native thinking, only applies
 * the middleware when the model matches known think-tag patterns — wrapping
 * arbitrary models with `startWithReasoning: true` would swallow their
 * entire response as reasoning content, producing empty messages.
 */
export function hasThinkTags(options: ThinkTagCheckOptions): boolean {
  const p = options.provider.toLowerCase();

  if (ALWAYS_THINK_TAG_PROVIDERS.has(p)) return true;

  if (p === "ollama") {
    // If Ollama supports native thinking for this model, it sends structured
    // delta.reasoning — no client-side <think> tag middleware needed.
    if (options.ollamaSupportsThinking === true) return false;
    // Only apply middleware for models known to emit <think> tags.
    // Wrapping non-thinking models with startWithReasoning: true would
    // capture their entire output as reasoning, leaving no text parts.
    if (options.modelId) {
      return isThinkTagModel(options.modelId);
    }
    return false;
  }

  return false;
}
