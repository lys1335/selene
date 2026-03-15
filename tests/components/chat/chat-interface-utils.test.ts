import { describe, expect, it } from "vitest";
import {
  getSessionActivityTimestamp,
  shouldBypassLivePromptForegroundDeferral,
  shouldDeferLivePromptForegroundReconciliation,
  sortSessionsByUpdatedAt,
} from "@/components/chat/chat-interface-utils";
import type { SessionInfo } from "@/components/chat/chat-sidebar/types";
import type { UIMessage } from "ai";

function createSession(overrides: Partial<SessionInfo> & Pick<SessionInfo, "id">): SessionInfo {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    characterId: overrides.characterId ?? "character-1",
    createdAt: overrides.createdAt ?? "2026-03-07T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-07T08:00:00.000Z",
    lastMessageAt: overrides.lastMessageAt ?? null,
    messageCount: overrides.messageCount ?? 0,
    totalTokenCount: overrides.totalTokenCount ?? 0,
    channelType: overrides.channelType ?? null,
    hasActiveRun: overrides.hasActiveRun ?? false,
    metadata: overrides.metadata ?? {},
  };
}

describe("chat session ordering helpers", () => {
  it("prefers lastMessageAt over updatedAt when sorting session recency", () => {
    const reorderedByToolChurn = createSession({
      id: "tool-churn",
      updatedAt: "2026-03-07T10:05:00.000Z",
      lastMessageAt: "2026-03-07T10:00:00.000Z",
    });
    const realLatestConversation = createSession({
      id: "real-latest",
      updatedAt: "2026-03-07T10:01:00.000Z",
      lastMessageAt: "2026-03-07T10:01:00.000Z",
    });

    const ordered = sortSessionsByUpdatedAt([reorderedByToolChurn, realLatestConversation]);

    expect(ordered.map((session) => session.id)).toEqual(["real-latest", "tool-churn"]);
  });

  it("falls back to updatedAt when no lastMessageAt exists", () => {
    const session = createSession({
      id: "fallback",
      updatedAt: "2026-03-07T09:30:00.000Z",
      lastMessageAt: null,
    });

    expect(getSessionActivityTimestamp(session)).toBe("2026-03-07T09:30:00.000Z");
  });

  it("defers live-prompt reconciliation only while persisted history is not ahead", () => {
    expect(shouldDeferLivePromptForegroundReconciliation({
      hasInjectedMessages: true,
      persistedConversationMessageCount: 3,
      liveThreadMessageCount: 3,
    })).toBe(true);

    expect(shouldDeferLivePromptForegroundReconciliation({
      hasInjectedMessages: true,
      persistedConversationMessageCount: 4,
      liveThreadMessageCount: 3,
    })).toBe(false);

    expect(shouldDeferLivePromptForegroundReconciliation({
      hasInjectedMessages: false,
      persistedConversationMessageCount: 3,
      liveThreadMessageCount: 3,
    })).toBe(false);
  });

  it("bypasses live-prompt deferral when progress points at a new persisted assistant segment", () => {
    const liveThreadMessages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Original prompt" }],
      },
      {
        id: "assistant-pre",
        role: "assistant",
        parts: [{ type: "text", text: "Initial assistant segment" }],
      },
    ] as UIMessage[];

    const persistedUiMessages = [
      ...liveThreadMessages,
      {
        id: "assistant-post",
        role: "assistant",
        parts: [
          { type: "text", text: "Continuation after queued (injected) message" },
          {
            type: "tool-localGrep",
            toolCallId: "call-real-1",
            state: "input-available",
            input: {
              pattern: "queued-live",
              paths: ["/Users/umuttan/seline/seline/components"],
              caseInsensitive: true,
              maxResults: 20,
            },
          },
        ],
      } as UIMessage,
    ];

    expect(shouldBypassLivePromptForegroundDeferral({
      liveThreadMessages,
      persistedUiMessages,
      progressAssistantMessageId: "assistant-post",
    })).toBe(true);
  });

  it("keeps deferral when progress still points at the current live assistant segment", () => {
    const liveThreadMessages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Original prompt" }],
      },
      {
        id: "assistant-pre",
        role: "assistant",
        parts: [{ type: "text", text: "Initial assistant segment" }],
      },
    ] as UIMessage[];

    expect(shouldBypassLivePromptForegroundDeferral({
      liveThreadMessages,
      persistedUiMessages: liveThreadMessages,
      progressAssistantMessageId: "assistant-pre",
    })).toBe(false);
  });
});
