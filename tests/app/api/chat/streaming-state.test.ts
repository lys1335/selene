import { describe, expect, it, vi, beforeEach } from "vitest";

// Use vi.hoisted to create the mock map before mocks are processed
const { mockActiveDelegations } = vi.hoisted(() => {
  return {
    mockActiveDelegations: new Map(),
  };
});

// Mock the module with a factory function that returns the mock
vi.mock("@/lib/ai/tools/delegate-to-subagent-types", () => {
  return {
    activeDelegations: mockActiveDelegations,
  };
});

import {
  sealDanglingToolCalls,
  type StreamingMessageState,
} from "@/app/api/chat/streaming-state";
import type { DBContentPart } from "@/lib/messages/converter";

function makeState(parts: DBContentPart[]): StreamingMessageState {
  return {
    parts,
    toolCallParts: new Map(),
    loggedIncompleteToolCalls: new Set(),
    lastBroadcastAt: 0,
    lastBroadcastSignature: "",
  };
}

describe("sealDanglingToolCalls", () => {
  beforeEach(() => {
    mockActiveDelegations.clear();
  });

  it("seals tool calls without matching results as error", () => {
    const state = makeState([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "readFile",
        args: { filePath: "test.ts" },
        state: "input-available",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    expect(changed).toBe(true);
    expect(state.parts).toHaveLength(2);
    expect(state.parts[1]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-1",
      result: {
        status: "error",
        error: "Tool execution ended before a result was persisted.",
        reconstructed: true,
      },
      status: "error",
      state: "output-error",
    });
  });

  it("does not seal tool calls that already have results", () => {
    const state = makeState([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "readFile",
        args: { filePath: "test.ts" },
        state: "input-available",
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "readFile",
        result: { status: "success" },
        status: "success",
        state: "output-available",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    expect(changed).toBe(false);
    expect(state.parts).toHaveLength(2);
  });

  it("does not seal observe calls for delegations that are still running", () => {
    // Set up a running delegation
    mockActiveDelegations.set("del-123", {
      id: "del-123",
      settled: false,
      sessionId: "sess-456",
    });

    const state = makeState([
      {
        type: "tool-call",
        toolCallId: "call-observe-1",
        toolName: "delegateToSubagent",
        args: { action: "observe", delegationId: "del-123" },
        state: "input-available",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    // Should NOT seal the observe call because the delegation is still running
    expect(changed).toBe(false);
    expect(state.parts).toHaveLength(1);
    expect(state.parts[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-observe-1",
      state: "input-available",
    });
  });

  it("seals observe calls for delegations that have settled", () => {
    // Set up a settled delegation
    mockActiveDelegations.set("del-123", {
      id: "del-123",
      settled: true,
      sessionId: "sess-456",
    });

    const state = makeState([
      {
        type: "tool-call",
        toolCallId: "call-observe-1",
        toolName: "delegateToSubagent",
        args: { action: "observe", delegationId: "del-123" },
        state: "input-available",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    // Should seal because the delegation is settled
    expect(changed).toBe(true);
    expect(state.parts).toHaveLength(2);
    expect(state.parts[1]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-observe-1",
      result: {
        status: "error",
        reconstructed: true,
      },
    });
  });

  it("seals observe calls for delegations that don't exist", () => {
    // No delegation in the map
    const state = makeState([
      {
        type: "tool-call",
        toolCallId: "call-observe-1",
        toolName: "delegateToSubagent",
        args: { action: "observe", delegationId: "del-nonexistent" },
        state: "input-available",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    // Should seal because the delegation doesn't exist
    expect(changed).toBe(true);
    expect(state.parts).toHaveLength(2);
  });

  it("does not seal start calls even for running delegations (they return immediately)", () => {
    // Set up a running delegation
    mockActiveDelegations.set("del-123", {
      id: "del-123",
      settled: false,
      sessionId: "sess-456",
    });

    const state = makeState([
      {
        type: "tool-call",
        toolCallId: "call-start-1",
        toolName: "delegateToSubagent",
        args: { action: "start", agentId: "agent-1", task: "do something" },
        state: "input-available",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    // Should seal because "start" returns immediately and should have a result
    expect(changed).toBe(true);
    expect(state.parts).toHaveLength(2);
  });

  it("handles mixed tool calls correctly - only seals non-observe dangling calls", () => {
    // Set up delegations: one running, one settled
    mockActiveDelegations.set("del-running", {
      id: "del-running",
      settled: false,
      sessionId: "sess-1",
    });
    mockActiveDelegations.set("del-settled", {
      id: "del-settled",
      settled: true,
      sessionId: "sess-2",
    });

    const state = makeState([
      // Regular tool call - should be sealed
      {
        type: "tool-call",
        toolCallId: "call-regular",
        toolName: "readFile",
        args: { filePath: "test.ts" },
        state: "input-available",
      },
      // Observe for running delegation - should NOT be sealed
      {
        type: "tool-call",
        toolCallId: "call-observe-running",
        toolName: "delegateToSubagent",
        args: { action: "observe", delegationId: "del-running" },
        state: "input-available",
      },
      // Observe for settled delegation - should be sealed
      {
        type: "tool-call",
        toolCallId: "call-observe-settled",
        toolName: "delegateToSubagent",
        args: { action: "observe", delegationId: "del-settled" },
        state: "input-available",
      },
    ]);

    const changed = sealDanglingToolCalls(state);

    expect(changed).toBe(true);
    // Should have 5 parts: 3 tool-calls + 2 sealed results (regular + observe-settled)
    expect(state.parts).toHaveLength(5);

    // Check that observe-running is NOT sealed
    const observeRunningResult = state.parts.find(
      (p) => p.type === "tool-result" && p.toolCallId === "call-observe-running"
    );
    expect(observeRunningResult).toBeUndefined();

    // Check that regular and observe-settled ARE sealed
    const regularResult = state.parts.find(
      (p) => p.type === "tool-result" && p.toolCallId === "call-regular"
    );
    expect(regularResult).toBeDefined();

    const observeSettledResult = state.parts.find(
      (p) => p.type === "tool-result" && p.toolCallId === "call-observe-settled"
    );
    expect(observeSettledResult).toBeDefined();
  });
});
