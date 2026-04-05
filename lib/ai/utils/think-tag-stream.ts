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
 * Returns `true` if the given provider is known to emit `<think>...</think>`
 * reasoning tags that should be intercepted by `thinkTagMiddleware`.
 *
 * For Ollama: returns `false` when the model supports native thinking
 * (Ollama v0.9.0+ parses tags server-side and sends structured
 * `delta.reasoning`). The AI SDK handles `delta.reasoning` natively,
 * so no middleware is needed. Pass `ollamaSupportsThinking` from the
 * capability check to control this.
 *
 * @param provider - The LLM provider identifier.
 * @param ollamaSupportsThinking - If the provider is "ollama", whether
 *   Ollama reported native thinking support for this model. When `undefined`
 *   and provider is "ollama", defaults to `true` (apply middleware as safety net).
 */
export function hasThinkTags(
  provider: string,
  ollamaSupportsThinking?: boolean,
): boolean {
  const p = provider.toLowerCase();

  if (ALWAYS_THINK_TAG_PROVIDERS.has(p)) return true;

  if (p === "ollama") {
    // If Ollama supports native thinking for this model, it sends structured
    // delta.reasoning — no client-side <think> tag middleware needed.
    // Default to true (apply middleware) when capability is unknown.
    if (ollamaSupportsThinking === true) return false;
    return true;
  }

  return false;
}
