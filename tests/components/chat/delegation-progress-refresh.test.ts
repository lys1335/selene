import { describe, expect, it } from "vitest";

import { shouldReloadSessionFromTaskProgress } from "@/components/chat/chat-interface-hooks";
import type { TaskProgressEvent } from "@/lib/background-tasks/types";

function makeProgressEvent(overrides: Partial<TaskProgressEvent> = {}): TaskProgressEvent {
  return {
    eventType: "task:progress",
    runId: "run-delegation-1",
    type: "chat",
    userId: "user-1",
    sessionId: "session-parent-1",
    characterId: "agent-init",
    progressText: "Delegation is streaming",
    progressContent: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("delegated progress refresh gating", () => {
  it("reloads the current session when delegated task progress is streamed for that session", () => {
    const detail = makeProgressEvent({
      progressContent: [
        {
          type: "tool-result",
          toolCallId: "toolu_1",
          toolName: "delegateToSubagent",
          state: "output-available",
          result: {
            delegationId: "del-1",
            sessionId: "session-child-1",
            running: true,
            completed: false,
          },
        },
      ],
    });

    expect(
      shouldReloadSessionFromTaskProgress({
        detail,
        sessionId: "session-parent-1",
        isChannelSession: false,
        isProcessingInBackground: false,
      })
    ).toBe(true);
  });

  it("reloads when task progress contains delegateToSubagent activity", () => {
    const detail = makeProgressEvent({
      progressContent: [
        {
          type: "tool-call",
          toolCallId: "toolu_delegate_1",
          toolName: "delegateToSubagent",
          state: "input-available",
          active: true,
          args: { action: "start", delegationId: "del-1" },
        },
        {
          type: "tool-result",
          toolCallId: "toolu_delegate_1",
          toolName: "delegateToSubagent",
          state: "output-available",
          result: {
            delegationId: "del-1",
            completed: true,
            running: false,
          },
        },
        {
          type: "tool-call",
          toolCallId: "toolu_delegate_2",
          toolName: "delegateToSubagent",
          state: "input-available",
          active: true,
          args: { action: "start", delegationId: "del-2" },
        },
        {
          type: "tool-call",
          toolCallId: "toolu_delegate_3",
          toolName: "delegateToSubagent",
          state: "input-available",
          active: true,
          args: { action: "start", delegationId: "del-3" },
        },
      ],
    });

    expect(
      shouldReloadSessionFromTaskProgress({
        detail,
        sessionId: "session-parent-1",
        isChannelSession: false,
        isProcessingInBackground: false,
      })
    ).toBe(true);
  });

  it("does not reload unrelated sessions for delegated task progress", () => {
    const detail = makeProgressEvent({
      progressContent: [
        {
          type: "tool-result",
          toolCallId: "toolu_1",
          toolName: "delegateToSubagent",
          state: "output-available",
          result: { delegationId: "del-1", running: true },
        },
      ],
    });

    expect(
      shouldReloadSessionFromTaskProgress({
        detail,
        sessionId: "different-session",
        isChannelSession: false,
        isProcessingInBackground: false,
      })
    ).toBe(false);
  });

  it("ignores active projected tool calls for unrelated tools", () => {
    const detail = makeProgressEvent({
      progressContent: [
        {
          type: "tool-call",
          toolCallId: "toolu_read_active",
          toolName: "readFile",
          state: "input-available",
          active: true,
          args: { filePath: "src/app.ts" },
        },
      ],
    });

    expect(
      shouldReloadSessionFromTaskProgress({
        detail,
        sessionId: "session-parent-1",
        isChannelSession: false,
        isProcessingInBackground: false,
      })
    ).toBe(false);
  });

  it("keeps existing background-refresh behavior for non-delegation progress only when background polling is active", () => {
    const plainProgress = makeProgressEvent({
      progressContent: [
        {
          type: "tool-result",
          toolCallId: "toolu_read",
          toolName: "readFile",
          state: "output-available",
          result: { status: "success" },
        },
      ],
    });

    expect(
      shouldReloadSessionFromTaskProgress({
        detail: plainProgress,
        sessionId: "session-parent-1",
        isChannelSession: false,
        isProcessingInBackground: false,
      })
    ).toBe(false);

    expect(
      shouldReloadSessionFromTaskProgress({
        detail: plainProgress,
        sessionId: "session-parent-1",
        isChannelSession: false,
        isProcessingInBackground: true,
      })
    ).toBe(true);
  });
});
