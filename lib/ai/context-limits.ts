import { MODEL_METADATA } from "@/lib/config/model-catalog";
import type { LLMProvider } from "@/components/model-bag/model-bag.types";
import { normalizeCodexModel } from "@/lib/auth/codex-models";

/**
 * Default context window limits per provider (in tokens)
 * Used as fallback when model metadata doesn't specify a limit
 */
const DEFAULT_PROVIDER_LIMITS: Record<LLMProvider, number> = {
  anthropic: 200000,   // All Claude models = 200K standard (per Anthropic docs)
  openrouter: 128000,  // Safe default for most modern models
  antigravity: 200000, // Claude-based = 200K; Gemini uses model-specific overrides
  codex: 400000,       // Mixed provider; keep legacy-safe default and override GPT-5.4 explicitly
  claudecode: 200000,  // Claude Opus 4.6 = 200K standard
  kimi: 128000,        // Kimi standard
  minimax: 80000,      // MiniMax M2.1 80K context
  blackboxai: 128000,  // BlackBox AI default context
  ollama: 8192,        // Llama 3 default (conservative)
  vllm: 32000,         // vLLM models vary; conservative default
};

/**
 * Parse a context window string (e.g., "200K", "1M") into a number
 */
export function parseContextWindow(value: string | undefined): number | null {
  if (!value) return null;
  
  const normalized = value.toUpperCase().trim();
  
  if (normalized.endsWith("K")) {
    return parseFloat(normalized.slice(0, -1)) * 1000;
  }
  
  if (normalized.endsWith("M")) {
    return parseFloat(normalized.slice(0, -1)) * 1000000;
  }
  
  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

/**
 * Get the context window limit for a specific model
 * 
 * @param modelId The model identifier
 * @param provider The provider (used for fallback defaults)
 * @returns The context window limit in tokens
 */
function resolveMetadataModelId(modelId: string, provider: LLMProvider): string {
  const baseModelId = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  const lowerModelId = baseModelId.toLowerCase();

  if (provider === "codex" || lowerModelId.includes("codex") || lowerModelId.includes("gpt-5")) {
    return normalizeCodexModel(baseModelId);
  }

  return baseModelId;
}

export function getModelContextLimit(modelId: string, provider: LLMProvider): number {
  const resolvedModelId = resolveMetadataModelId(modelId, provider);

  // 1. Check specific model metadata
  const meta = MODEL_METADATA[modelId] ?? MODEL_METADATA[resolvedModelId];
  if (meta?.capabilities?.contextWindow) {
    const parsed = parseContextWindow(meta.capabilities.contextWindow);
    if (parsed) return parsed;
  }

  // 2. Check provider default
  return DEFAULT_PROVIDER_LIMITS[provider] ?? 128000;
}

/**
 * Calculate the compaction threshold for a model
 * 
 * @param modelId The model identifier
 * @param provider The provider
 * @param thresholdRatio The ratio of context window to use before compacting (default: 0.75)
 * @returns The token count threshold that triggers compaction
 */
export function getCompactionThreshold(
  modelId: string, 
  provider: LLMProvider, 
  thresholdRatio = 0.75
): number {
  const limit = getModelContextLimit(modelId, provider);
  return Math.floor(limit * thresholdRatio);
}

/**
 * Calculate the hard stop limit (when to block new messages)
 * Usually slightly less than the full context window to leave room for the response
 * 
 * @param modelId The model identifier
 * @param provider The provider
 * @param safetyBuffer Buffer to leave for response generation (default: 4096 tokens)
 * @returns The max token count allowed before blocking
 */
export function getHardStopLimit(
  modelId: string,
  provider: LLMProvider,
  safetyBuffer = 4096
): number {
  const limit = getModelContextLimit(modelId, provider);
  return Math.max(0, limit - safetyBuffer);
}
