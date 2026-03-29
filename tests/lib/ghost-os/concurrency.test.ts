import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveGhostOsOperation,
  setActiveGhostOsOperation,
  clearActiveGhostOsOperation,
  checkGhostOsConcurrency,
  wrapGhostOsExecution,
} from "@/lib/ghost-os/concurrency";

describe("Ghost OS Concurrency Detection", () => {
  beforeEach(() => {
    clearActiveGhostOsOperation();
  });

  describe("active operation tracking", () => {
    it("should start with no active operation", () => {
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should set and get active operation", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now(),
      });

      const op = getActiveGhostOsOperation();
      expect(op).toBeDefined();
      expect(op!.characterId).toBe("agent-1");
      expect(op!.toolName).toBe("ghost_click");
      expect(op!.opId).toBe("test-op-1");
    });

    it("should clear active operation", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now(),
      });

      clearActiveGhostOsOperation();
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should auto-clear stale action operations (default 60s TTL)", () => {
      setActiveGhostOsOperation({
        opId: "test-op-stale",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now() - 61_000, // 61 seconds ago — exceeds 60s TTL
      });

      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should NOT auto-clear ghost_run within 5 minute TTL", () => {
      setActiveGhostOsOperation({
        opId: "test-op-recipe",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_run",
        rootSessionId: "session-1",
        startedAt: Date.now() - 120_000, // 2 minutes ago — within 5min TTL
      });

      expect(getActiveGhostOsOperation()).toBeDefined();
    });

    it("should auto-clear ghost_run after 5 minute TTL", () => {
      setActiveGhostOsOperation({
        opId: "test-op-recipe-stale",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_run",
        rootSessionId: "session-1",
        startedAt: Date.now() - 301_000, // 5+ minutes ago
      });

      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should not auto-clear fresh operations", () => {
      setActiveGhostOsOperation({
        opId: "test-op-fresh",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now() - 30_000, // 30 seconds ago — within TTL
      });

      expect(getActiveGhostOsOperation()).toBeDefined();
    });

    it("should support opId-scoped clear (only clears matching op)", () => {
      setActiveGhostOsOperation({
        opId: "op-A",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now(),
      });

      // Try to clear with wrong opId — should NOT clear
      clearActiveGhostOsOperation("op-B");
      expect(getActiveGhostOsOperation()).toBeDefined();
      expect(getActiveGhostOsOperation()!.opId).toBe("op-A");

      // Clear with correct opId — should clear
      clearActiveGhostOsOperation("op-A");
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should unconditionally clear when no opId provided (backward compat/tests)", () => {
      setActiveGhostOsOperation({
        opId: "op-any",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now(),
      });

      clearActiveGhostOsOperation();
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });
  });

  describe("checkGhostOsConcurrency", () => {
    it("should return null for non-Ghost OS servers", () => {
      const result = checkGhostOsConcurrency(
        "other-server",
        "some_tool",
        "agent-1",
        "Agent One",
        "session-1",
      );
      expect(result).toBeNull();
    });

    it("should return null for perception tools (non-action)", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-2",
        characterName: "Agent Two",
        toolName: "ghost_click",
        rootSessionId: "session-2",
        startedAt: Date.now(),
      });

      const result = checkGhostOsConcurrency(
        "ghostos",
        "ghost_context", // perception tool — not an action
        "agent-1",
        "Agent One",
        "session-1",
      );
      expect(result).toBeNull();
    });

    it("should return null when no active operation", () => {
      const result = checkGhostOsConcurrency(
        "ghostos",
        "ghost_click",
        "agent-1",
        "Agent One",
        "session-1",
      );
      expect(result).toBeNull();
    });

    it("should return null for same agent's sequential calls", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now(),
      });

      const result = checkGhostOsConcurrency(
        "ghostos",
        "ghost_type",
        "agent-1", // same agent
        "Agent One",
        "session-1",
      );
      expect(result).toBeNull();
    });

    it("should return null for same delegation chain (same rootSessionId)", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "root-session",
        startedAt: Date.now(),
      });

      const result = checkGhostOsConcurrency(
        "ghostos",
        "ghost_type",
        "agent-2", // different agent
        "Agent Two",
        "root-session", // same root session — delegated
      );
      expect(result).toBeNull();
    });

    it("should NOT suppress warning when rootSessionId is empty string", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "", // empty
        startedAt: Date.now() - 5000,
      });

      const result = checkGhostOsConcurrency(
        "ghostos",
        "ghost_type",
        "agent-2",
        "Agent Two",
        "", // both empty — should still warn, not falsely suppress
      );
      expect(result).not.toBeNull();
      expect(result).toContain("Agent One");
    });

    it("should return warning for different agent from different session", () => {
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now() - 5000, // 5 seconds ago
      });

      const result = checkGhostOsConcurrency(
        "ghostos",
        "ghost_type",
        "agent-2",
        "Agent Two",
        "session-2", // different root session
      );
      expect(result).not.toBeNull();
      expect(result).toContain("Agent One");
      expect(result).toContain("ghost_click");
    });
  });

  describe("wrapGhostOsExecution", () => {
    it("should pass through non-Ghost OS tools without tracking", async () => {
      const { warning, execute } = wrapGhostOsExecution(
        "other-server",
        "some_tool",
        "agent-1",
        "Agent One",
        "session-1",
      );

      expect(warning).toBeNull();

      const result = await execute(async () => "done");
      expect(result).toBe("done");
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should track Ghost OS action tool execution", async () => {
      const { warning, execute } = wrapGhostOsExecution(
        "ghostos",
        "ghost_click",
        "agent-1",
        "Agent One",
        "session-1",
      );

      expect(warning).toBeNull();

      let activeOpDuringExecution: any;
      await execute(async () => {
        activeOpDuringExecution = getActiveGhostOsOperation();
        return "clicked";
      });

      expect(activeOpDuringExecution).toBeDefined();
      expect(activeOpDuringExecution.characterId).toBe("agent-1");
      expect(activeOpDuringExecution.toolName).toBe("ghost_click");
      expect(activeOpDuringExecution.opId).toBeDefined();

      // Should be cleared after execution
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should clear operation even on error", async () => {
      const { execute } = wrapGhostOsExecution(
        "ghostos",
        "ghost_click",
        "agent-1",
        "Agent One",
        "session-1",
      );

      await expect(
        execute(async () => {
          throw new Error("click failed");
        }),
      ).rejects.toThrow("click failed");

      expect(getActiveGhostOsOperation()).toBeUndefined();
    });

    it("should not track perception tools in active operation", async () => {
      const { execute } = wrapGhostOsExecution(
        "ghostos",
        "ghost_context", // perception tool
        "agent-1",
        "Agent One",
        "session-1",
      );

      let activeOpDuringExecution: any;
      await execute(async () => {
        activeOpDuringExecution = getActiveGhostOsOperation();
        return "context data";
      });

      // Perception tools should NOT set active operation
      expect(activeOpDuringExecution).toBeUndefined();
    });

    it("should include warning when conflict detected", async () => {
      // Set up existing operation from another agent
      setActiveGhostOsOperation({
        opId: "test-op-1",
        characterId: "agent-1",
        characterName: "Agent One",
        toolName: "ghost_click",
        rootSessionId: "session-1",
        startedAt: Date.now(),
      });

      const { warning } = wrapGhostOsExecution(
        "ghostos",
        "ghost_type",
        "agent-2",
        "Agent Two",
        "session-2",
      );

      expect(warning).not.toBeNull();
      expect(warning).toContain("Agent One");
    });

    it("should safely handle concurrent executions from the same agent (opId prevents race)", async () => {
      // Simulate two concurrent calls from the same agent with the same tool
      const wrap1 = wrapGhostOsExecution(
        "ghostos",
        "ghost_click",
        "agent-1",
        "Agent One",
        "session-1",
      );
      const wrap2 = wrapGhostOsExecution(
        "ghostos",
        "ghost_click",
        "agent-1",
        "Agent One",
        "session-1",
      );

      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

      // Start both executions concurrently
      const exec1 = wrap1.execute(async () => {
        // Wait for exec2 to start and overwrite the active op
        await firstPromise;
        return "result-1";
      });

      const exec2Promise = wrap2.execute(async () => {
        // exec2 starts while exec1 is still waiting — overwrites active op
        resolveFirst(); // let exec1 proceed
        return "result-2";
      });

      // Wait for exec2 to finish
      await exec2Promise;

      // exec2 finished — but since exec1's opId doesn't match anymore,
      // exec1's finally block should NOT clear exec2's tracking.
      // However, exec2 already completed and cleared its own op.
      // The important thing: no undefined behavior, no thrown errors.
      const result1 = await exec1;
      expect(result1).toBe("result-1");

      // After both complete, the global should be clear
      expect(getActiveGhostOsOperation()).toBeUndefined();
    });
  });
});
