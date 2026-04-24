/**
 * LLM Provider Type
 *
 * Extracted here to break the circular dependency between
 * providers.ts (which imports model-validation.ts) and
 * model-validation.ts (which needs the LLMProvider type).
 *
 * Both files import LLMProvider from this module.
 */

export type LLMProvider =
  | "anthropic"
  | "openrouter"
  | "antigravity"
  | "codex"
  | "kimi"
  | "ollama"
  | "claudecode"
  | "minimax"
  | "blackboxai"
  | "deepseek"
  | "vllm";

/**
 * Providers whose OpenAI-compatible `/chat/completions` endpoint does NOT
 * accept `image_url` content parts. Sending a user message with an image part
 * to one of these providers returns:
 *
 *   "Failed to deserialize the JSON body into the target type:
 *    messages[1]: unknown variant `image_url`"
 *
 * When the active provider is in this set:
 *  - `app/api/chat/message-prep.ts` strips inline images from outgoing
 *    requests and replaces them with a `describeImage(...)` placeholder.
 *  - `app/api/chat/tools-builder.ts` auto-promotes `describeImage` for the
 *    single turn so the placeholder's instruction actually lands on an
 *    available tool.
 *  - The chat composer surfaces a warning badge to the user BEFORE they
 *    send, so they know Selene will route their image through the vision
 *    tool path instead of the chat model.
 *
 * Keep this set as the single source of truth; both server-side prep logic
 * and client-side composer UX read from the same helper.
 */
export const PROVIDERS_REJECTING_INLINE_IMAGES: ReadonlySet<LLMProvider> =
  new Set<LLMProvider>(["deepseek"]);

/**
 * Returns true when the outbound chat-completions endpoint of `provider`
 * will reject `image_url` content parts. Used by both the server-side
 * prep pipeline and the composer UI to stay in sync.
 *
 * Accepts `string | null | undefined` so callers can pass raw settings
 * values without narrowing first; unknown providers are treated as
 * image-capable (safe default — if we're wrong the backend will still
 * log the strip).
 */
export function providerRejectsInlineImages(
  provider: string | null | undefined,
): boolean {
  if (!provider) return false;
  return PROVIDERS_REJECTING_INLINE_IMAGES.has(provider as LLMProvider);
}
