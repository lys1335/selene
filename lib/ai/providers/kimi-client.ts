/**
 * Kimi (Moonshot) Client
 *
 * Lazy-initialized OpenAI-compatible client for the Moonshot Kimi API.
 * Supports dual auth: OAuth (via Kimi device flow) or API key (env vars).
 * OAuth is preferred when available and uses the Kimi coding endpoint.
 * Includes a custom fetch wrapper that disables thinking mode and sets the
 * required fixed parameter values for non-thinking mode per Kimi K2.5 docs.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { KIMI_CONFIG } from "@/lib/auth/kimi-models";
import { isKimiOAuthAuthenticated, getKimiAccessToken, getKimiDeviceHeaders, KIMI_OAUTH_CONFIG } from "@/lib/auth/kimi-auth";
import { getAppUrl } from "./openrouter-client";

// ---- Configuration -----------------------------------------------------------

export function getKimiApiKey(): string | undefined {
  return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
}

// ---- Custom fetch ------------------------------------------------------------

/**
 * Custom fetch wrapper for Kimi API.
 * Disables thinking mode and enforces required parameter values
 * per Kimi K2.5 docs (non-thinking mode requires specific fixed values).
 */
async function kimiCustomFetch(
  url: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

  // Inject device headers directly into every request when using OAuth.
  // SDK-level headers may not propagate User-Agent reliably through Node.js HTTP/2.
  if (isKimiOAuthAuthenticated()) {
    const deviceHeaders = getKimiDeviceHeaders();
    const existingHeaders = new Headers(init?.headers);
    for (const [key, value] of Object.entries(deviceHeaders)) {
      existingHeaders.set(key, value);
    }
    init = { ...init, headers: existingHeaders };
  }

  if (init?.body && typeof init.body === "string" && urlStr.includes("/chat/completions")) {
    try {
      const body = JSON.parse(init.body);
      // Disable thinking mode — reasoning outputs should not persist in history
      body.thinking = { type: "disabled" };
      // Non-thinking mode requires these fixed values per Kimi K2.5 docs
      // Use lower temperature when tools are present for more deterministic tool selection
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      body.temperature = hasTools ? 0.4 : 0.6;
      body.top_p = 0.95;
      body.n = 1;
      body.presence_penalty = 0.0;
      body.frequency_penalty = 0.0;
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      // Not JSON, pass through unchanged
    }
  }
  return globalThis.fetch(url, init);
}

// ---- Lazy singleton ----------------------------------------------------------

let _kimiClient: ReturnType<typeof createOpenAICompatible> | null = null;
let _kimiClientApiKey: string | undefined = undefined;
let _kimiClientIsOAuth: boolean = false;

export function getKimiClient(): ReturnType<typeof createOpenAICompatible> {
  const isOAuth = isKimiOAuthAuthenticated();
  const apiKey = isOAuth ? (getKimiAccessToken() ?? undefined) : getKimiApiKey();
  const baseURL = isOAuth ? KIMI_OAUTH_CONFIG.API_BASE_URL : KIMI_CONFIG.BASE_URL;
  const extraHeaders = isOAuth ? getKimiDeviceHeaders() : {};

  // Recreate client if API key or auth mode changed
  if (_kimiClient && (_kimiClientApiKey !== apiKey || _kimiClientIsOAuth !== isOAuth)) {
    _kimiClient = null;
  }

  if (!_kimiClient) {
    _kimiClientApiKey = apiKey;
    _kimiClientIsOAuth = isOAuth;
    _kimiClient = createOpenAICompatible({
      name: "kimi",
      baseURL,
      apiKey: apiKey || "",
      headers: {
        ...extraHeaders,
        "HTTP-Referer": getAppUrl(),
        "X-Title": "Selene Agent",
      },
      fetch: kimiCustomFetch,
    });
  }

  return _kimiClient;
}

export function invalidateKimiClient(): void {
  _kimiClient = null;
  _kimiClientApiKey = undefined;
  _kimiClientIsOAuth = false;
}
