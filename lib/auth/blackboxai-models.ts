/**
 * BlackBox AI Model Definitions
 *
 * BlackBox AI provides access to its own native models (search, coding, vision)
 * as well as routing to major frontier models from Anthropic, OpenAI, Google,
 * DeepSeek, and Meta through a unified OpenAI-compatible API.
 *
 * API: OpenAI-compatible at https://api.blackbox.ai
 */

export const BLACKBOX_MODEL_IDS = [
  // BlackBox native models
  "blackbox-search",
  "qwen3-coder",
  "qwen3-max",
  "qwen3-vl-32b",

  // Anthropic (via BlackBox routing)
  "claude-sonnet-4.6",
  "claude-opus-4.6",

  // OpenAI (via BlackBox routing)
  "gpt-5.2-codex",

  // Google (via BlackBox routing)
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",

  // DeepSeek (via BlackBox routing)
  "deepseek-r1",
  "deepseek-chat-v3.1",

  // Meta (via BlackBox routing)
  "llama-4-maverick",
] as const;

export type BlackBoxModelId = (typeof BLACKBOX_MODEL_IDS)[number];

// Default models for different roles
export const BLACKBOX_DEFAULT_MODELS = {
  chat: "qwen3-coder" as BlackBoxModelId,
  utility: "blackbox-search" as BlackBoxModelId,
  research: "claude-sonnet-4.6" as BlackBoxModelId,
  vision: "qwen3-vl-32b" as BlackBoxModelId,
};

// BlackBox AI API configuration
export const BLACKBOX_CONFIG = {
  BASE_URL: "https://api.blackbox.ai",
} as const;

// Model display names
const MODEL_LABELS: Record<string, string> = {
  "blackbox-search": "BlackBox Search",
  "qwen3-coder": "Qwen3 Coder",
  "qwen3-max": "Qwen3 Max",
  "qwen3-vl-32b": "Qwen3 VL 32B",
  "claude-sonnet-4.6": "Claude Sonnet 4.6",
  "claude-opus-4.6": "Claude Opus 4.6",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  "gemini-3-pro-preview": "Gemini 3 Pro Preview",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "deepseek-r1": "DeepSeek R1",
  "deepseek-chat-v3.1": "DeepSeek Chat v3.1",
  "llama-4-maverick": "Llama 4 Maverick",
};

/**
 * Get display name for a BlackBox AI model
 */
export function getBlackBoxModelDisplayName(modelId: string): string {
  return MODEL_LABELS[modelId] || modelId;
}

/**
 * Get all BlackBox AI models with display names
 */
export function getBlackBoxModels(): Array<{ id: BlackBoxModelId; name: string }> {
  return BLACKBOX_MODEL_IDS.map((id) => ({
    id,
    name: getBlackBoxModelDisplayName(id),
  }));
}
