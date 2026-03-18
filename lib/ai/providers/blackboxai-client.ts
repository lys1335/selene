/**
 * BlackBox AI Client
 *
 * Lazy-initialized OpenAI-compatible client for the BlackBox AI API.
 * BlackBox AI provides an OpenAI-compatible endpoint at https://api.blackbox.ai
 * with access to native models and routed frontier models.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { BLACKBOX_CONFIG } from "@/lib/auth/blackboxai-models";
import { getAppUrl } from "./openrouter-client";

// ---- Configuration -----------------------------------------------------------

export function getBlackBoxApiKey(): string | undefined {
  return process.env.BLACKBOX_API_KEY || process.env.BLACKBOXAI_API_KEY;
}

// ---- Lazy singleton ----------------------------------------------------------

let _blackboxClient: ReturnType<typeof createOpenAICompatible> | null = null;
let _blackboxClientApiKey: string | undefined = undefined;

export function getBlackBoxClient(): ReturnType<typeof createOpenAICompatible> {
  const apiKey = getBlackBoxApiKey();

  // Recreate client if API key changed
  if (_blackboxClient && _blackboxClientApiKey !== apiKey) {
    _blackboxClient = null;
  }

  if (!_blackboxClient) {
    _blackboxClientApiKey = apiKey;
    _blackboxClient = createOpenAICompatible({
      name: "blackboxai",
      baseURL: BLACKBOX_CONFIG.BASE_URL,
      apiKey: apiKey || "",
      headers: {
        "HTTP-Referer": getAppUrl(),
        "X-Title": "Selene Agent",
      },
    });
  }

  return _blackboxClient;
}

export function invalidateBlackBoxClient(): void {
  _blackboxClient = null;
  _blackboxClientApiKey = undefined;
}
