/**
 * vLLM Client
 *
 * Lazy-initialized OpenAI-compatible client for a vLLM server.
 * The base URL is resolved from settings or the VLLM_BASE_URL environment
 * variable and defaults to http://localhost:8000/v1.
 *
 * Unlike Ollama (which always runs locally), vLLM may be on a remote GPU
 * server (e.g. RunPod). An optional API key is supported for secured deployments.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadSettings } from "@/lib/settings/settings-manager";

// ---- Configuration -----------------------------------------------------------

const VLLM_DEFAULT_BASE_URL = "http://localhost:8000/v1";

function normalizeVllmUrl(url: string): string {
  // Strip trailing slash
  let normalized = url.replace(/\/+$/, "");
  // Auto-append /v1 if not present — createOpenAICompatible constructs
  // paths as ${baseURL}/chat/completions, so /v1 must be in the base URL.
  if (!normalized.endsWith("/v1")) {
    normalized += "/v1";
  }
  return normalized;
}

export function getVllmBaseUrl(): string {
  const settings = loadSettings();
  const raw = settings.vllmBaseUrl || process.env.VLLM_BASE_URL || VLLM_DEFAULT_BASE_URL;
  return normalizeVllmUrl(raw);
}

export function getVllmApiKey(): string {
  const settings = loadSettings();
  return settings.vllmApiKey || process.env.VLLM_API_KEY || "";
}

// ---- Lazy singleton ----------------------------------------------------------

let _vllmClient: ReturnType<typeof createOpenAICompatible> | null = null;
let _vllmClientBaseUrl: string | undefined = undefined;
let _vllmClientApiKey: string | undefined = undefined;

export function getVllmClient(): ReturnType<typeof createOpenAICompatible> {
  const baseURL = getVllmBaseUrl();
  const apiKey = getVllmApiKey();

  if (!baseURL) {
    throw new Error(
      "vLLM base URL is not configured. Set vllmBaseUrl or VLLM_BASE_URL."
    );
  }

  // Recreate client if config changed
  if (_vllmClient && (_vllmClientBaseUrl !== baseURL || _vllmClientApiKey !== apiKey)) {
    _vllmClient = null;
  }

  if (!_vllmClient) {
    _vllmClientBaseUrl = baseURL;
    _vllmClientApiKey = apiKey;
    _vllmClient = createOpenAICompatible({
      name: "vllm",
      baseURL,
      apiKey: apiKey || "dummy", // OpenAI SDK requires a non-empty string
    });
  }

  return _vllmClient;
}

export function invalidateVllmClient(): void {
  _vllmClient = null;
  _vllmClientBaseUrl = undefined;
  _vllmClientApiKey = undefined;
}
