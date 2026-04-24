/**
 * Tests for reasoning_content round-trip handling in prepareMessagesForRequest.
 *
 * Two behaviors under test:
 *   1. Verbatim replay — DeepSeek messages with stored reasoning get their
 *      reasoning parts injected back before the outbound request.
 *   2. Synthetic placeholder — assistant messages with tool calls but no
 *      reasoning anywhere (the "foreign-provider" case: Claude Code / Codex
 *      turns mixed into a DeepSeek thread) get a placeholder reasoning block
 *      so DeepSeek's validator accepts the request instead of 400-ing with
 *      "The `reasoning_content` in the thinking mode must be passed back".
 *
 * We target `prepareMessagesForRequest` end-to-end rather than the private
 * helper, so the public contract — "coreMessages have reasoning where
 * needed" — is what's actually verified.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const dbMessagesMock = vi.hoisted(() => ({
  messages: [] as Array<{ id: string; role: string; content: unknown }>,
}));

vi.mock("@/lib/db/queries-messages", () => ({
  getMessages: vi.fn(async () => dbMessagesMock.messages),
}));

// Tool-enhancement pass-through so we isolate reasoning behavior from DB
// tool-result refetching (not relevant to this fix).
vi.mock("@/lib/messages/tool-enhancement", async () => {
  return {
    enhanceFrontendMessagesWithToolResults: vi.fn(async (messages: unknown[]) => messages),
  };
});

// Tool factories are called but not exercised — replace with no-ops.
vi.mock("@/lib/ai/tools", () => ({
  createRetrieveFullContentTool: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/web-search", () => ({
  createWebSearchTool: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/vector-search", () => ({
  createVectorSearchToolV2: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/tools/read-file-tool", () => ({
  createReadFileTool: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/ripgrep", () => ({
  createLocalGrepTool: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/tools/channel-tools", () => ({
  createSendMessageToChannelTool: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/tools/skill-tool", () => ({
  createSkillTool: vi.fn(() => ({})),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { prepareMessagesForRequest } from "@/app/api/chat/message-prep";
import type { FrontendMessage } from "@/lib/messages/tool-enhancement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AssistantCore = { role: "assistant"; content: unknown };

function assistantMessages(
  coreMessages: Array<{ role: string; content: unknown }>,
): AssistantCore[] {
  return coreMessages.filter((m): m is AssistantCore => m.role === "assistant");
}

function reasoningTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const part of content as Array<{ type?: string; text?: unknown }>) {
    if (part?.type === "reasoning" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("prepareMessagesForRequest — reasoning round-trip", () => {
  beforeEach(() => {
    dbMessagesMock.messages = [];
  });

  it("replays DB-stored reasoning verbatim for DeepSeek assistant messages with tool calls", async () => {
    const assistantId = "asst-deepseek-1";

    // DB has the original reasoning that was stripped from the UI message.
    dbMessagesMock.messages = [
      {
        id: assistantId,
        role: "assistant",
        content: [
          { type: "reasoning", text: "Step 1: I need to list files." },
          { type: "tool-call", toolCallId: "call_00_a", toolName: "localGrep", input: { pattern: "foo" } },
          { type: "tool-result", toolCallId: "call_00_a", toolName: "localGrep", output: "match" },
        ],
      },
    ];

    // Frontend message is what UI actually sends — reasoning stripped, tool parts present.
    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "search for foo" }] } as FrontendMessage,
      {
        id: assistantId,
        role: "assistant",
        parts: [
          {
            type: "tool-localGrep",
            toolCallId: "call_00_a",
            toolName: "localGrep",
            input: { pattern: "foo" },
            output: "match",
          },
        ],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "go on" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-1",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    expect(reasoningTexts(assistants[0].content)).toEqual([
      "Step 1: I need to list files.",
    ]);
  });

  it("synthesizes a placeholder reasoning block for foreign-provider tool-call turns under DeepSeek", async () => {
    const foreignAssistantId = "asst-claude-code-1";

    // Foreign provider wrote tool calls to the DB with ZERO reasoning — the
    // exact pattern observed in the installed-app session that triggered
    // DeepSeek's 400.
    dbMessagesMock.messages = [
      {
        id: foreignAssistantId,
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "toolu_01xyz", toolName: "searchTools", input: { query: "a" } },
          { type: "tool-result", toolCallId: "toolu_01xyz", toolName: "searchTools", output: "ok" },
        ],
      },
    ];

    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "continue" }] } as FrontendMessage,
      {
        id: foreignAssistantId,
        role: "assistant",
        parts: [
          {
            type: "tool-searchTools",
            toolCallId: "toolu_01xyz",
            toolName: "searchTools",
            input: { query: "a" },
            output: "ok",
          },
        ],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "go on" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-2",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    const texts = reasoningTexts(assistants[0].content);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/non-thinking-mode/i);
    expect(texts[0]).toMatch(/no chain-of-thought/i);
  });

  it("synthesizes a placeholder for pure-text foreign-provider assistant turns under DeepSeek", async () => {
    // Plain-text assistant reply from a non-thinking-mode provider (e.g. Kimi
    // or Claude Code). DeepSeek thinking mode rejects ANY prior assistant
    // turn missing `reasoning_content`, not just tool-call turns — so the
    // placeholder must also cover text-only turns.
    dbMessagesMock.messages = [
      {
        id: "asst-plain",
        role: "assistant",
        content: [{ type: "text", text: "Sure, got it." }],
      },
    ];

    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] } as FrontendMessage,
      {
        id: "asst-plain",
        role: "assistant",
        parts: [{ type: "text", text: "Sure, got it." }],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "go" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-3",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    const texts = reasoningTexts(assistants[0].content);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/non-thinking-mode/i);
  });

  it("is a no-op for non-DeepSeek providers (no reasoning injected)", async () => {
    // Same payload as the foreign-tool-call case, but we're going to Claude
    // — Anthropic requires a signature on thinking blocks so we MUST NOT
    // inject a fake reasoning part.
    dbMessagesMock.messages = [
      {
        id: "asst-anything",
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "searchTools", input: {} },
        ],
      },
    ];

    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] } as FrontendMessage,
      {
        id: "asst-anything",
        role: "assistant",
        parts: [
          {
            type: "tool-searchTools",
            toolCallId: "tc1",
            toolName: "searchTools",
            input: {},
            output: "ok",
          },
        ],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "go" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-4",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "claude-sonnet-4-5",
      currentProvider: "anthropic",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    expect(reasoningTexts(assistants[0].content)).toEqual([]);
  });

  it("does not duplicate reasoning when frontend already carries it", async () => {
    // Forward-compat: if a future refactor teaches the UI to keep reasoning
    // on the round-trip, we should not inject the same text twice.
    const assistantId = "asst-deepseek-dupe";
    const reasoningText = "Already present on frontend.";

    dbMessagesMock.messages = [
      {
        id: assistantId,
        role: "assistant",
        content: [
          { type: "reasoning", text: reasoningText },
          { type: "tool-call", toolCallId: "c1", toolName: "localGrep", input: {} },
        ],
      },
    ];

    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] } as FrontendMessage,
      {
        id: assistantId,
        role: "assistant",
        parts: [
          { type: "reasoning", text: reasoningText },
          {
            type: "tool-localGrep",
            toolCallId: "c1",
            toolName: "localGrep",
            input: {},
            output: "ok",
          },
        ],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "go" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-5",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    expect(reasoningTexts(assistants[0].content)).toEqual([reasoningText]);
  });

  it("falls back to placeholder reasoning when the frontend assistant id does not match the DB row", async () => {
    dbMessagesMock.messages = [
      {
        id: "db-assistant-id",
        role: "assistant",
        content: [
          { type: "reasoning", text: "Stored under a different id." },
          { type: "tool-call", toolCallId: "tc-mismatch", toolName: "localGrep", input: {} },
        ],
      },
    ];

    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] } as FrontendMessage,
      {
        id: "ui-assistant-id",
        role: "assistant",
        parts: [
          {
            type: "tool-localGrep",
            toolCallId: "tc-mismatch",
            toolName: "localGrep",
            input: {},
            output: "ok",
          },
        ],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "continue" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-6",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    const texts = reasoningTexts(assistants[0].content);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/non-thinking-mode/i);
  });

  it("guarantees reasoning on every split assistant ModelMessage (tool-call + trailing text)", async () => {
    // The live failure: an assistant turn shaped like
    //   [reasoning, tool-call, tool-result, tool-call, tool-result, text, text]
    // splits into (step 1) assistant[reasoning, text, tool-call, tool-call] →
    // (tool) [tool-result, tool-result] → (step 2) assistant[text]. The step-2
    // assistant message has no reasoning and DeepSeek rejects it with:
    //   "The `reasoning_content` in the thinking mode must be passed back."
    // The post-split guarantee must prepend a placeholder to step 2.
    const assistantId = "asst-split-trailing";
    dbMessagesMock.messages = [
      {
        id: assistantId,
        role: "assistant",
        content: [
          { type: "reasoning", text: "Original step-1 reasoning." },
          { type: "tool-call", toolCallId: "c1", toolName: "readFile", input: { path: "a" } },
          { type: "tool-result", toolCallId: "c1", toolName: "readFile", output: "A" },
          { type: "tool-call", toolCallId: "c2", toolName: "readFile", input: { path: "b" } },
          { type: "tool-result", toolCallId: "c2", toolName: "readFile", output: "B" },
          { type: "text", text: "Summary of what I read." },
        ],
      },
    ];

    const frontend: FrontendMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "do two file reads" }] } as FrontendMessage,
      {
        id: assistantId,
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Original step-1 reasoning." },
          {
            type: "tool-readFile",
            toolCallId: "c1",
            toolName: "readFile",
            input: { path: "a" },
            output: "A",
          },
          {
            type: "tool-readFile",
            toolCallId: "c2",
            toolName: "readFile",
            input: { path: "b" },
            output: "B",
          },
          { type: "text", text: "Summary of what I read." },
        ],
      } as FrontendMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "ok go on" }] } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-split-1",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    // Splitter should produce two assistant messages: step-1 (reasoning +
    // tool-calls) and step-2 (trailing text). Both must carry reasoning.
    expect(assistants.length).toBeGreaterThanOrEqual(2);
    for (const asst of assistants) {
      expect(reasoningTexts(asst.content).length).toBeGreaterThan(0);
    }
  });

  it("injects reasoning when assistant history arrives in content arrays instead of parts", async () => {
    const assistantId = "asst-content-array";

    dbMessagesMock.messages = [
      {
        id: assistantId,
        role: "assistant",
        content: [
          { type: "reasoning", text: "Recovered from DB content." },
          { type: "tool-call", toolCallId: "tc-content", toolName: "searchTools", input: { query: "grep" } },
        ],
      },
    ];

    const frontend = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "continue" }] },
      {
        id: assistantId,
        role: "assistant",
        content: [
          {
            type: "tool-searchTools",
            toolCallId: "tc-content",
            toolName: "searchTools",
            input: { query: "grep" },
            output: "ok",
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "go on" }] },
    ] as FrontendMessage[];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-7",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const assistants = assistantMessages(coreMessages);
    expect(assistants).toHaveLength(1);
    expect(reasoningTexts(assistants[0].content)).toEqual(["Recovered from DB content."]);
  });

  it("strips user image parts for DeepSeek and replaces each with a text placeholder", async () => {
    // DeepSeek's `/chat/completions` rejects `image_url` content variants with
    // "unknown variant `image_url`". The pipeline must drop image parts before
    // serialization and replace each with a readable text marker.
    const frontend: FrontendMessage[] = [
      {
        id: "u-image",
        role: "user",
        parts: [
          { type: "text", text: "Here are two screenshots:" },
          // Data URIs that extractContent will emit as `{type: "image", image}`
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,iVBORw0KGgo=",
            filename: "one.png",
          },
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AAAA=",
            filename: "two.png",
          },
          { type: "text", text: "what do you see?" },
        ],
      } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-img",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "deepseek-v4-pro",
      currentProvider: "deepseek",
    });

    const userMsg = coreMessages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    const parts = userMsg!.content;
    expect(Array.isArray(parts)).toBe(true);

    const partList = parts as Array<{ type: string; image?: unknown; text?: unknown }>;
    const imageParts = partList.filter((p) => p.type === "image");
    expect(imageParts).toHaveLength(0);

    // Each dropped image should have been replaced by a text placeholder.
    const textParts = partList.filter((p) => p.type === "text");
    const placeholders = textParts.filter((p) =>
      typeof p.text === "string" && (p.text as string).includes("image attachment omitted"),
    );
    expect(placeholders).toHaveLength(2);
  });

  it("leaves images untouched for non-deepseek providers", async () => {
    const frontend: FrontendMessage[] = [
      {
        id: "u-image",
        role: "user",
        parts: [
          { type: "text", text: "look at this" },
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,iVBORw0KGgo=",
            filename: "pic.png",
          },
        ],
      } as FrontendMessage,
    ];

    const { coreMessages } = await prepareMessagesForRequest({
      messages: frontend,
      sessionId: "sess-img-claude",
      userId: "user-1",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "claude-sonnet-4-6",
      currentProvider: "anthropic",
    });

    const userMsg = coreMessages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    const partList = userMsg!.content as Array<{ type: string }>;
    const imageParts = partList.filter((p) => p.type === "image");
    expect(imageParts.length).toBeGreaterThan(0);
  });
});
