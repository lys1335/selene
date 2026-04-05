/**
 * POST /api/ollama/pull
 *
 * Proxies Ollama's POST /api/pull with streaming.
 * Accepts `{ model: string }` in the request body.
 * Streams newline-delimited JSON (NDJSON) progress objects to the client.
 *
 * Ollama's pull endpoint streams objects like:
 *   {"status":"pulling manifest"}
 *   {"status":"downloading","digest":"sha256:...","total":4661211808,"completed":1234567}
 *   {"status":"success"}
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings/settings-manager";
import { validateOllamaUrl } from "../validate-url";

const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";

function getOllamaBaseUrl(): string {
  const settings = loadSettings();
  return validateOllamaUrl(
    settings.ollamaBaseUrl ||
    process.env.OLLAMA_BASE_URL ||
    OLLAMA_DEFAULT_BASE_URL,
  );
}

export async function POST(request: Request) {
  let body: { model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.model || typeof body.model !== "string") {
    return NextResponse.json(
      { error: "Missing required field: model" },
      { status: 400 },
    );
  }

  const baseUrl = getOllamaBaseUrl();
  const abortController = new AbortController();

  // If the client disconnects, abort the upstream request
  request.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  try {
    const upstreamResponse = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: body.model, stream: true }),
      signal: abortController.signal,
    });

    if (!upstreamResponse.ok) {
      const text = await upstreamResponse.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Ollama pull failed: ${upstreamResponse.status} ${upstreamResponse.statusText}`,
          detail: text,
        },
        { status: upstreamResponse.status },
      );
    }

    if (!upstreamResponse.body) {
      return NextResponse.json(
        { error: "No response body from Ollama" },
        { status: 502 },
      );
    }

    // Stream the NDJSON through to the client
    const upstream = upstreamResponse.body;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          // Client disconnect or upstream error
          if (
            err instanceof Error &&
            (err.name === "AbortError" || err.message.includes("aborted"))
          ) {
            controller.close();
          } else {
            controller.error(err);
          }
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return NextResponse.json(
        {
          error:
            "Could not connect to Ollama. Make sure the Ollama server is running.",
        },
        { status: 503 },
      );
    }

    console.error("[OllamaPull] Pull request failed:", message);
    return NextResponse.json(
      { error: `Pull failed: ${message}` },
      { status: 500 },
    );
  }
}
