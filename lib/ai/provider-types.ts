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
  | "vllm";
