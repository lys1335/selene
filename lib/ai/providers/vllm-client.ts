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

export function getVllmBaseUrl(): string {
  const settings = loadSettings();
  return settings.vllmBaseUrl || process.env.VLLM_BASE_URL || VLLM_DEFAULT_BASE_URL;
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
