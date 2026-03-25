import { beforeEach, describe, expect, it } from "vitest";

import {
  addDelegationCompletion,
  drainDelegationCompletions,
  hasPendingDelegationCompletions,
} from "@/lib/ai/tools/delegation-completion-store";

const SESSION_ID = "initiator-session-1";

describe("delegation completion store", () => {
  beforeEach(() => {
    drainDelegationCompletions(SESSION_ID);
  });

  it("tracks pending completions per initiator session", () => {
    expect(hasPendingDelegationCompletions(SESSION_ID)).toBe(false);

    addDelegationCompletion({
      delegationId: "del-1",
      delegateName: "Explore",
      sessionId: "deleg-session-1",
      initiatorSessionId: SESSION_ID,
      characterId: "agent-init",
      completedAt: Date.now(),
    });

    expect(hasPendingDelegationCompletions(SESSION_ID)).toBe(true);
  });

  it("drains completions and clears them from the store", () => {
    addDelegationCompletion({
      delegationId: "del-1",
      delegateName: "Explore",
      sessionId: "deleg-session-1",
      initiatorSessionId: SESSION_ID,
      characterId: "agent-init",
      completedAt: 123,
    });
    addDelegationCompletion({
      delegationId: "del-2",
      delegateName: "Reviewer",
      sessionId: "deleg-session-2",
      initiatorSessionId: SESSION_ID,
      characterId: "agent-init",
      completedAt: 456,
      error: "failed",
    });

    expect(drainDelegationCompletions(SESSION_ID)).toEqual([
      expect.objectContaining({ delegationId: "del-1", delegateName: "Explore", completedAt: 123 }),
      expect.objectContaining({ delegationId: "del-2", delegateName: "Reviewer", completedAt: 456, error: "failed" }),
    ]);
    expect(hasPendingDelegationCompletions(SESSION_ID)).toBe(false);
    expect(drainDelegationCompletions(SESSION_ID)).toEqual([]);
  });
});
