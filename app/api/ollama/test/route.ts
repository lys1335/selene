/**
 * POST /api/ollama/test
 *
 * Tests Ollama connectivity by hitting /api/tags and /api/version.
 * Accepts an optional `{ baseUrl }` in the request body; falls back
 * to the URL stored in settings.
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings/settings-manager";

const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";
const REQUEST_TIMEOUT_MS = 5000;

function resolveBaseUrl(override?: string): string {
  if (override) {
    return override.replace(/\/v1\/?$/, "");
  }
  const settings = loadSettings();
  const url =
    settings.ollamaBaseUrl ||
    process.env.OLLAMA_BASE_URL ||
    OLLAMA_DEFAULT_BASE_URL;
  return url.replace(/\/v1\/?$/, "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const baseUrl = resolveBaseUrl(body.baseUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Fetch tags and version in parallel
    const [tagsRes, versionRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      }),
      fetch(`${baseUrl}/api/version`, {
        method: "GET",
        signal: controller.signal,
      }),
    ]);

    clearTimeout(timeout);

    if (tagsRes.status === "rejected") {
      const msg =
        tagsRes.reason instanceof Error
          ? tagsRes.reason.message
          : String(tagsRes.reason);
      return NextResponse.json({
        ok: false,
        error: msg.includes("ECONNREFUSED") || msg.includes("fetch failed")
          ? "Could not connect to Ollama. Make sure the Ollama server is running."
          : `Failed to reach Ollama: ${msg}`,
      });
    }

    if (!tagsRes.value.ok) {
      return NextResponse.json({
        ok: false,
        error: `Ollama responded with ${tagsRes.value.status} ${tagsRes.value.statusText}`,
      });
    }

    const tagsData = await tagsRes.value.json();

    let version: string | undefined;
    if (versionRes.status === "fulfilled" && versionRes.value.ok) {
      try {
        const versionData = await versionRes.value.json();
        version = versionData.version;
      } catch {
        // version endpoint may not exist on older Ollama — ignore
      }
    }

    return NextResponse.json({
      ok: true,
      models: tagsData.models ?? [],
      version,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OllamaTest] Connectivity test failed:", message);
    return NextResponse.json({ ok: false, error: message });
  }
}
