import { describe, expect, it, vi, beforeEach } from "vitest";

const delegationMocks = vi.hoisted(() => ({
  getActiveDelegationsForCharacter: vi.fn(),
}));

vi.mock("@/lib/ai/tools/delegate-to-subagent-tool", () => ({
  getActiveDelegationsForCharacter: delegationMocks.getActiveDelegationsForCharacter,
}));

import {
  hasRunningDelegationsForSession,
  shouldStopClaudeCodeTurn,
} from "@/app/api/chat/delegation-waiting";

describe("delegation waiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports running delegations only for active entries", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([
      { delegationId: "del-1", running: false, completed: true },
      { delegationId: "del-2", running: true, completed: false },
    ]);

    expect(hasRunningDelegationsForSession("agent-init", "sess-1")).toBe(true);
    expect(delegationMocks.getActiveDelegationsForCharacter).toHaveBeenCalledWith("agent-init", "sess-1");
  });

  it("stops immediately when there is no character scope", () => {
    expect(hasRunningDelegationsForSession(null, "sess-1")).toBe(false);
  });

  it("keeps Claude Code alive after step 0 while delegations are still running", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([
      { delegationId: "del-1", running: true, completed: false },
    ]);

    expect(
      shouldStopClaudeCodeTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 1,
        maxSteps: 10,
      })
    ).toBe(false);
  });

  it("allows the Claude Code turn to finish once no delegations are running", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([
      { delegationId: "del-1", running: false, completed: true },
    ]);

    expect(
      shouldStopClaudeCodeTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 1,
        maxSteps: 10,
      })
    ).toBe(true);
  });

  it("never stops before the first step has had a chance to run", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([]);

    expect(
      shouldStopClaudeCodeTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 0,
        maxSteps: 10,
      })
    ).toBe(false);
  });

  it("still enforces the global max step limit", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([
      { delegationId: "del-1", running: true, completed: false },
    ]);

    expect(
      shouldStopClaudeCodeTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 10,
        maxSteps: 10,
      })
    ).toBe(true);
  });
});
