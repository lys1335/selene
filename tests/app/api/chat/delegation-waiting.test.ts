import { describe, expect, it, vi, beforeEach } from "vitest";

const delegationMocks = vi.hoisted(() => ({
  getActiveDelegationsForCharacter: vi.fn(),
}));

vi.mock("@/lib/ai/tools/delegate-to-subagent-tool", () => ({
  getActiveDelegationsForCharacter: delegationMocks.getActiveDelegationsForCharacter,
}));

import {
  hasRunningDelegationsForSession,
  hasDelegationsForSession,
  shouldStopTurn,
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
      shouldStopTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 1,
        maxSteps: 10,
      })
    ).toBe(false);
  });

  it("does not force-stop the turn when delegations are settled (model needs to observe results)", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([
      { delegationId: "del-1", running: false, completed: true },
    ]);

    // Previously this returned true, which caused the serialization regression:
    // the model couldn't observe results before the turn was force-stopped.
    expect(
      shouldStopTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 1,
        maxSteps: 10,
      })
    ).toBe(false);
  });

  it("never stops before the first step has had a chance to run", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([]);

    expect(
      shouldStopTurn({
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
      shouldStopTurn({
        characterId: "agent-init",
        initiatorSessionId: "sess-1",
        stepCount: 10,
        maxSteps: 10,
      })
    ).toBe(true);
  });

  it("does not stop multi-step execution when session has no delegations at all", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([]);

    expect(
      shouldStopTurn({
        characterId: "agent-subagent",
        initiatorSessionId: "sess-sub",
        stepCount: 1,
        maxSteps: 10,
      })
    ).toBe(false);

    expect(
      shouldStopTurn({
        characterId: "agent-subagent",
        initiatorSessionId: "sess-sub",
        stepCount: 5,
        maxSteps: 10,
      })
    ).toBe(false);
  });

  it("hasDelegationsForSession returns false for null characterId", () => {
    expect(hasDelegationsForSession(null, "sess-1")).toBe(false);
  });

  it("hasDelegationsForSession detects any delegation regardless of running state", () => {
    delegationMocks.getActiveDelegationsForCharacter.mockReturnValue([
      { delegationId: "del-1", running: false, completed: true },
    ]);

    expect(hasDelegationsForSession("agent-init", "sess-1")).toBe(true);
  });
});
