import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings/settings-manager";

/**
 * GET /api/vllm/models
 * Probes the configured vLLM server and returns available models.
 * Uses the saved base URL from settings — no external URL override to prevent SSRF.
 */
export async function GET() {
  try {
    const settings = loadSettings();
    let baseUrl = settings.vllmBaseUrl || "http://localhost:8000/v1";

    // Normalize: strip trailing slash
    baseUrl = baseUrl.replace(/\/+$/, "");

    // Ensure it ends with /v1
    if (!baseUrl.endsWith("/v1")) {
      baseUrl = `${baseUrl}/v1`;
    }

    const apiKey = settings.vllmApiKey;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `vLLM server returned ${response.status}`, models: [] },
        { status: 502 }
      );
    }

    const data = await response.json();

    // OpenAI-compatible /v1/models returns { data: [{ id, ... }] }
    const models = (data.data || []).map((m: { id: string }) => m.id);

    return NextResponse.json({ models, baseUrl });
  } catch {
    return NextResponse.json(
      { error: "Could not connect to vLLM server", models: [] },
      { status: 502 }
    );
  }
}
