type CodexSseEvent = {
  type?: string;
  response?: unknown;
};

type ParsedSseResult =
  | { kind: "success"; response: unknown }
  | { kind: "error"; message: string; type?: string }
  | { kind: "none" };

function parseSseStream(sseText: string): ParsedSseResult {
  const lines = sseText.split("\n");

  // Accumulate text from streaming delta events in case response.done.output is empty
  let accumulatedText = "";
  let doneResponse: unknown = null;
  let hadDoneEvent = false;

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (!payload) continue;

    try {
      const data = JSON.parse(payload) as CodexSseEvent & {
        delta?: string;
        text?: string;
        part?: { text?: string };
        error?: { type?: string; message?: string };
      };

      // Accumulate text from delta events (these carry the actual generated content)
      if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
        accumulatedText += data.delta;
        continue;
      }

      // response.output_text.done has the full text for a content part
      if (data.type === "response.output_text.done" && typeof data.text === "string") {
        // Use this as authoritative if available (overrides deltas)
        accumulatedText = data.text;
        continue;
      }

      // response.content_part.done may also carry the full text
      if (data.type === "response.content_part.done" && data.part && typeof data.part.text === "string") {
        accumulatedText = data.part.text;
        continue;
      }

      // Successful completion
      if (data.type === "response.done" || data.type === "response.completed") {
        doneResponse = data.response ?? null;
        hadDoneEvent = true;
        continue; // Don't return yet — finish parsing all events
      }

      // Response failed — extract the actual error from the response object
      if (data.type === "response.failed") {
        const responseObj = data.response as Record<string, unknown> | undefined;
        const statusError = responseObj?.status_details as Record<string, unknown> | undefined;
        const errorObj = (responseObj?.error ?? statusError?.error ?? data.error) as
          | { type?: string; message?: string }
          | undefined;
        const message =
          errorObj?.message ??
          (typeof responseObj?.error === "string" ? responseObj.error : null) ??
          "Response failed (no details)";
        return { kind: "error", message, type: errorObj?.type };
      }

      // Explicit error event
      if (data.type === "error" && data.error) {
        return {
          kind: "error",
          message: data.error.message ?? "Unknown error event",
          type: data.error.type,
        };
      }
    } catch {
      // Ignore malformed JSON.
    }
  }

  if (!hadDoneEvent) {
    return { kind: "none" };
  }

  // If response.done had empty output but we accumulated text from deltas,
  // inject the accumulated text into the response output
  if (accumulatedText && doneResponse) {
    const responseObj = doneResponse as Record<string, unknown>;
    const output = responseObj.output as unknown[] | undefined;
    const outputIsEmpty = !Array.isArray(output) || output.length === 0;

    if (outputIsEmpty) {
      console.log("[CodexResponse] response.done had empty output — injecting accumulated text from delta events", {
        accumulatedTextLength: accumulatedText.length,
      });
      // Reconstruct the output array in the format the AI SDK expects
      responseObj.output = [
        {
          type: "message",
          role: "assistant",
          id: "injected_from_deltas",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: accumulatedText,
              annotations: [],
            },
          ],
        },
      ];
    }
  }

  return { kind: "success", response: doneResponse };
}

export class CodexStreamError extends Error {
  public readonly errorType?: string;
  constructor(message: string, errorType?: string) {
    super(message);
    this.name = "CodexStreamError";
    this.errorType = errorType;
  }
}

export async function convertSseToJson(
  response: Response,
  headers: Headers,
  signal?: AbortSignal,
): Promise<Response> {
  if (!response.body) {
    throw new Error("[CodexResponse] Response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  try {
    while (true) {
      if (signal?.aborted) {
        try { reader.cancel(); } catch {}
        throw new DOMException("Aborted", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    try { reader.cancel(); } catch {}
    throw error;
  }

  const parsed = parseSseStream(fullText);

  if (parsed.kind === "error") {
    console.error("[CodexResponse] SSE stream contained error event:", parsed.message, parsed.type);
    throw new CodexStreamError(
      `Codex API error: ${parsed.message}`,
      parsed.type,
    );
  }

  if (parsed.kind === "none") {
    // No terminal event found — return raw text for caller to handle
    console.warn("[CodexResponse] No terminal SSE event found in stream", {
      textLength: fullText.length,
      preview: fullText.slice(0, 500),
    });
    return new Response(fullText, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // Log diagnostic info about the response structure for non-streaming callers
  const responseObj = parsed.response as Record<string, unknown> | null;
  if (responseObj) {
    const status = responseObj.status as string | undefined;
    const output = responseObj.output as unknown[] | undefined;
    const outputTypes = Array.isArray(output) ? output.map((o: any) => o?.type).filter(Boolean) : [];
    const hasContent = Array.isArray(output) && output.some((o: any) => {
      if (o?.type === "message" && Array.isArray(o.content)) {
        return o.content.some((c: any) => c?.type === "output_text" && c?.text?.length > 0);
      }
      return false;
    });
    console.log("[CodexResponse] Parsed response.done:", {
      status,
      outputCount: output?.length ?? 0,
      outputTypes,
      hasTextContent: hasContent,
      ...(status && status !== "completed" ? { fullResponse: JSON.stringify(responseObj).slice(0, 1000) } : {}),
    });

    // If response has status "incomplete" or "failed", treat as error
    if (status === "incomplete") {
      const incompleteReason = (responseObj.incomplete_details as Record<string, unknown>)?.reason ?? "unknown";
      throw new CodexStreamError(
        `Codex response incomplete: ${incompleteReason}`,
        "incomplete_response",
      );
    }
    if (status === "failed") {
      const errorDetails = responseObj.error as Record<string, unknown> | undefined;
      const statusDetails = responseObj.status_details as Record<string, unknown> | undefined;
      const errorMsg = (errorDetails?.message ?? statusDetails?.error ?? "unknown failure") as string;
      throw new CodexStreamError(
        `Codex response failed: ${errorMsg}`,
        "response_failed",
      );
    }
  }

  const jsonHeaders = new Headers(headers);
  jsonHeaders.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(parsed.response), {
    status: response.status,
    statusText: response.statusText,
    headers: jsonHeaders,
  });
}

export function ensureContentType(headers: Headers): Headers {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "text/event-stream; charset=utf-8");
  }
  return responseHeaders;
}
