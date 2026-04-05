/**
 * Tests for Ollama model capability detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOllamaModelCapabilities,
  ollamaModelSupportsThinking,
  clearOllamaCapabilityCache,
} from "../ollama-capabilities";

// Mock loadSettings — default: empty ollamaBaseUrl (falls through to env/default)
vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: () => ({ ollamaBaseUrl: "" }),
}));

// Suppress console.warn/debug noise in test output
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(response: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(response),
  });
}

// ---------------------------------------------------------------------------
// getOllamaModelCapabilities
// ---------------------------------------------------------------------------

describe("getOllamaModelCapabilities", () => {
  beforeEach(() => {
    clearOllamaCapabilityCache();
    vi.stubGlobal("fetch", mockFetch({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns capabilities from /api/show response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ capabilities: ["completion", "tools", "thinking"] }),
    );

    const caps = await getOllamaModelCapabilities("deepseek-r1:7b");
    expect(caps).toEqual(["completion", "tools", "thinking"]);
  });

  it("returns empty array when capabilities field is absent (old Ollama)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ modelfile: "FROM ...", template: "..." }),
    );

    const caps = await getOllamaModelCapabilities("llama3.1:8b");
    expect(caps).toEqual([]);
  });

  it("returns empty array on HTTP error", async () => {
    vi.stubGlobal("fetch", mockFetch({}, 404));

    const caps = await getOllamaModelCapabilities("nonexistent-model");
    expect(caps).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const caps = await getOllamaModelCapabilities("gemma4");
    expect(caps).toEqual([]);
  });

  it("returns empty array on AbortError (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(abortError),
    );

    const caps = await getOllamaModelCapabilities("slow-model");
    expect(caps).toEqual([]);
  });

  // ── Caching ──────────────────────────────────────────────────────────────

  it("caches results for the same model", async () => {
    const fetchMock = mockFetch({
      capabilities: ["completion", "thinking"],
    });
    vi.stubGlobal("fetch", fetchMock);

    await getOllamaModelCapabilities("qwen3:8b");
    await getOllamaModelCapabilities("qwen3:8b");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses case-insensitive cache keys", async () => {
    const fetchMock = mockFetch({
      capabilities: ["thinking"],
    });
    vi.stubGlobal("fetch", fetchMock);

    await getOllamaModelCapabilities("DeepSeek-R1:7B");
    const caps = await getOllamaModelCapabilities("deepseek-r1:7b");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caps).toEqual(["thinking"]);
  });

  it("negative-caches failures to avoid hammering a downed server", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    // First call fails and gets negatively cached
    await getOllamaModelCapabilities("some-model");
    // Second call should hit the negative cache, not fetch again
    await getOllamaModelCapabilities("some-model");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("negative-caches HTTP errors", async () => {
    const fetchMock = mockFetch({}, 500);
    vi.stubGlobal("fetch", fetchMock);

    await getOllamaModelCapabilities("bad-model");
    await getOllamaModelCapabilities("bad-model");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests for the same model", async () => {
    let resolvePromise: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // Fire two concurrent requests
    const p1 = getOllamaModelCapabilities("gemma4");
    const p2 = getOllamaModelCapabilities("gemma4");

    // Resolve the single underlying fetch
    resolvePromise!({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ capabilities: ["thinking"] }),
    } as Response);

    const [caps1, caps2] = await Promise.all([p1, p2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caps1).toEqual(["thinking"]);
    expect(caps2).toEqual(["thinking"]);
  });

  // ── Request format ───────────────────────────────────────────────────────

  it("sends POST request to /api/show with model name and correct headers", async () => {
    const fetchMock = mockFetch({ capabilities: [] });
    vi.stubGlobal("fetch", fetchMock);

    await getOllamaModelCapabilities("gemma4:12b");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/show"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gemma4:12b" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("strips /v1 suffix from base URL before calling /api/show", async () => {
    // Set env var to simulate a URL with /v1 suffix
    const origEnv = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://myhost:11434/v1";

    const fetchMock = mockFetch({ capabilities: [] });
    vi.stubGlobal("fetch", fetchMock);

    await getOllamaModelCapabilities("test-model-v1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://myhost:11434/api/show",
      expect.any(Object),
    );

    process.env.OLLAMA_BASE_URL = origEnv;
  });

  it("strips /v1/ suffix (with trailing slash) from base URL", async () => {
    const origEnv = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://myhost:11434/v1/";

    const fetchMock = mockFetch({ capabilities: [] });
    vi.stubGlobal("fetch", fetchMock);

    await getOllamaModelCapabilities("test-model-v1-slash");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://myhost:11434/api/show",
      expect.any(Object),
    );

    process.env.OLLAMA_BASE_URL = origEnv;
  });
});

// ---------------------------------------------------------------------------
// ollamaModelSupportsThinking
// ---------------------------------------------------------------------------

describe("ollamaModelSupportsThinking", () => {
  beforeEach(() => {
    clearOllamaCapabilityCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when capabilities include 'thinking'", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ capabilities: ["completion", "tools", "thinking"] }),
    );

    expect(await ollamaModelSupportsThinking("deepseek-r1")).toBe(true);
  });

  it("returns true for gemma4 with thinking capability", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ capabilities: ["completion", "thinking"] }),
    );

    expect(await ollamaModelSupportsThinking("gemma4")).toBe(true);
  });

  it("returns false when capabilities don't include 'thinking'", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ capabilities: ["completion", "tools"] }),
    );

    expect(await ollamaModelSupportsThinking("llama3.1:8b")).toBe(false);
  });

  it("returns false when capabilities are empty (old Ollama)", async () => {
    vi.stubGlobal("fetch", mockFetch({}));

    expect(await ollamaModelSupportsThinking("any-model")).toBe(false);
  });

  it("returns false on network failure (graceful fallback)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    expect(await ollamaModelSupportsThinking("gemma4")).toBe(false);
  });

  it("returns false on timeout (graceful fallback)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );

    expect(await ollamaModelSupportsThinking("slow-model")).toBe(false);
  });
});
