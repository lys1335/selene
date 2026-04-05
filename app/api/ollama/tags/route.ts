/**
 * GET /api/ollama/tags
 *
 * Proxies Ollama's GET /api/tags to return the list of installed models.
 * No auth required — Ollama is a local service.
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings/settings-manager";

const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";
const REQUEST_TIMEOUT_MS = 5000;

function getOllamaBaseUrl(): string {
  const settings = loadSettings();
  const url =
    settings.ollamaBaseUrl ||
    process.env.OLLAMA_BASE_URL ||
    OLLAMA_DEFAULT_BASE_URL;
  return url.replace(/\/v1\/?$/, "");
}

export async function GET() {
  try {
    const baseUrl = getOllamaBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Ollama responded with ${response.status} ${response.statusText}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Request to Ollama timed out. Is the server running?" },
        { status: 504 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown error";

    // ECONNREFUSED indicates Ollama is not running
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return NextResponse.json(
        {
          error:
            "Could not connect to Ollama. Make sure the Ollama server is running.",
        },
        { status: 503 },
      );
    }

    console.error("[OllamaTags] Failed to fetch tags:", message);
    return NextResponse.json(
      { error: `Failed to fetch models from Ollama: ${message}` },
      { status: 500 },
    );
  }
}
