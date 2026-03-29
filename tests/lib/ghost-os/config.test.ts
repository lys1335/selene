import { describe, it, expect } from "vitest";
import {
  GHOST_OS_SERVER_NAME,
  isGhostOsTool,
  isGhostOsActionTool,
} from "@/lib/ghost-os/config";

describe("Ghost OS Config", () => {
  describe("GHOST_OS_SERVER_NAME", () => {
    it("should be 'ghostos'", () => {
      expect(GHOST_OS_SERVER_NAME).toBe("ghostos");
    });
  });

  describe("isGhostOsTool", () => {
    it("should identify Ghost OS tool IDs", () => {
      expect(isGhostOsTool("mcp_ghostos_ghost_click")).toBe(true);
      expect(isGhostOsTool("mcp_ghostos_ghost_context")).toBe(true);
      expect(isGhostOsTool("mcp_ghostos_ghost_type")).toBe(true);
    });

    it("should not match non-Ghost OS tool IDs", () => {
      expect(isGhostOsTool("mcp_linear_create_issue")).toBe(false);
      expect(isGhostOsTool("chromiumWorkspace")).toBe(false);
      expect(isGhostOsTool("webSearch")).toBe(false);
    });
  });

  describe("isGhostOsActionTool", () => {
    it("should identify action tools", () => {
      expect(isGhostOsActionTool("ghost_click")).toBe(true);
      expect(isGhostOsActionTool("ghost_type")).toBe(true);
      expect(isGhostOsActionTool("ghost_press")).toBe(true);
      expect(isGhostOsActionTool("ghost_hotkey")).toBe(true);
      expect(isGhostOsActionTool("ghost_scroll")).toBe(true);
      expect(isGhostOsActionTool("ghost_hover")).toBe(true);
      expect(isGhostOsActionTool("ghost_drag")).toBe(true);
      expect(isGhostOsActionTool("ghost_long_press")).toBe(true);
      expect(isGhostOsActionTool("ghost_focus")).toBe(true);
      expect(isGhostOsActionTool("ghost_window")).toBe(true);
    });

    it("should not identify perception tools as actions", () => {
      expect(isGhostOsActionTool("ghost_context")).toBe(false);
      expect(isGhostOsActionTool("ghost_state")).toBe(false);
      expect(isGhostOsActionTool("ghost_find")).toBe(false);
      expect(isGhostOsActionTool("ghost_read")).toBe(false);
      expect(isGhostOsActionTool("ghost_inspect")).toBe(false);
      expect(isGhostOsActionTool("ghost_screenshot")).toBe(false);
    });

    it("should not identify recipe/learning tools as actions", () => {
      expect(isGhostOsActionTool("ghost_recipes")).toBe(false);
      expect(isGhostOsActionTool("ghost_recipe_save")).toBe(false);
      expect(isGhostOsActionTool("ghost_learn_start")).toBe(false);
      expect(isGhostOsActionTool("ghost_learn_stop")).toBe(false);
    });
  });
});
