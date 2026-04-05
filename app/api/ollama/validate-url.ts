/**
 * Shared Ollama URL validation for all /api/ollama/* routes.
 *
 * Validates protocol (http/https only) and URL well-formedness.
 * No host restriction — Ollama may run locally, on LAN, or on a cloud VM.
 */

/**
 * Validates and sanitizes an Ollama base URL.
 * Returns the cleaned URL or throws if invalid.
 */
export function validateOllamaUrl(raw: string): string {
  const cleaned = raw.replace(/\/v1\/?$/, "").replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(
      `Invalid Ollama URL: "${raw}". Expected a valid URL like http://localhost:11434`,
    );
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `Unsupported protocol "${parsed.protocol}" in Ollama URL. Only http and https are allowed.`,
    );
  }

  return `${parsed.protocol}//${parsed.host}`;
}
