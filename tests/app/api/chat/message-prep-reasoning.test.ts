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

  it("does not touch assistant messages that have no tool calls and no reasoning", async () => {
    // Plain-text assistant reply from some prior run — nothing to replay and
    // no tool calls means DeepSeek does not require reasoning.
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
    expect(reasoningTexts(assistants[0].content)).toEqual([]);
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
});
