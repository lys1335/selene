/**
 * Think-tag streaming middleware for vLLM / Ollama models.
 *
 * Models like Qwen3.5 emit chain-of-thought reasoning wrapped in
 * `<think>...</think>` tags as part of their text output. This middleware
 * intercepts those tags at the stream level and converts them into proper
 * AI SDK reasoning parts so the UI can render a collapsible "thinking"
 * section instead of leaking raw XML into the chat.
 *
 * Implementation: delegates to the AI SDK's built-in
 * `extractReasoningMiddleware` which already handles all streaming edge
 * cases (tag split across chunks, multiple think blocks, unclosed tags on
 * stream abort, etc.).
 */

import { extractReasoningMiddleware } from "ai";
import type { LanguageModelMiddleware } from "ai";

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

// Providers that ALWAYS emit `<think>` tags regardless of model.
const THINK_TAG_PROVIDERS = new Set(["vllm"]);

/**
 * Model name patterns known to emit `<think>` reasoning tags.
 * Used for providers like Ollama where only some models are thinking models.
 */
const THINK_TAG_MODEL_PATTERNS = [
  "deepseek",
  "qwq",
  "qwen",
  "r1",
];

/**
 * Returns `true` if the given provider + model combination is known to emit
 * `<think>...</think>` reasoning tags that should be intercepted by
 * `thinkTagMiddleware`.
 *
 * For Ollama, only models whose name matches a known thinking-model pattern
 * are wrapped. Non-thinking models (e.g. llama3, functiongemma) must not be
 * wrapped — the middleware would swallow their normal text output as
 * "reasoning" that never gets persisted, causing empty assistant messages.
 */
export function hasThinkTags(provider: string, modelId?: string): boolean {
  const lower = provider.toLowerCase();
  if (THINK_TAG_PROVIDERS.has(lower)) return true;

  if (lower === "ollama") {
    if (!modelId) return false;
    const lowerModel = modelId.toLowerCase();
    return THINK_TAG_MODEL_PATTERNS.some((p) => lowerModel.includes(p));
  }

  return false;
}
