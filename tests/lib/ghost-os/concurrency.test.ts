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
    });

    it("should clear active operation", () => {
      setActiveGhostOsOperation({
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

    it("should return warning for different agent from different session", () => {
      setActiveGhostOsOperation({
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
  });
});
