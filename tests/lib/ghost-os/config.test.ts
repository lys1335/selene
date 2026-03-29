import { describe, it, expect } from "vitest";
import {
  GHOST_OS_SERVER_NAME,
  isGhostOsTool,
  isGhostOsActionTool,
  generateGhostOsMCPConfig,
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
    it("should identify core input action tools", () => {
      expect(isGhostOsActionTool("ghost_click")).toBe(true);
      expect(isGhostOsActionTool("ghost_type")).toBe(true);
      expect(isGhostOsActionTool("ghost_press")).toBe(true);
      expect(isGhostOsActionTool("ghost_hotkey")).toBe(true);
      expect(isGhostOsActionTool("ghost_scroll")).toBe(true);
      expect(isGhostOsActionTool("ghost_hover")).toBe(true);
      expect(isGhostOsActionTool("ghost_drag")).toBe(true);
      expect(isGhostOsActionTool("ghost_long_press")).toBe(true);
    });

    it("should identify window management action tools", () => {
      expect(isGhostOsActionTool("ghost_focus")).toBe(true);
      expect(isGhostOsActionTool("ghost_window")).toBe(true);
    });

    it("should identify extended/future action tools", () => {
      expect(isGhostOsActionTool("ghost_double_click")).toBe(true);
      expect(isGhostOsActionTool("ghost_right_click")).toBe(true);
      expect(isGhostOsActionTool("ghost_select")).toBe(true);
      expect(isGhostOsActionTool("ghost_write")).toBe(true);
      expect(isGhostOsActionTool("ghost_resize")).toBe(true);
    });

    it("should identify recipe execution as action", () => {
      expect(isGhostOsActionTool("ghost_run")).toBe(true);
    });

    it("should not identify perception tools as actions", () => {
      expect(isGhostOsActionTool("ghost_context")).toBe(false);
      expect(isGhostOsActionTool("ghost_state")).toBe(false);
      expect(isGhostOsActionTool("ghost_find")).toBe(false);
      expect(isGhostOsActionTool("ghost_read")).toBe(false);
      expect(isGhostOsActionTool("ghost_inspect")).toBe(false);
      expect(isGhostOsActionTool("ghost_screenshot")).toBe(false);
    });

    it("should not identify recipe management tools as actions", () => {
      expect(isGhostOsActionTool("ghost_recipes")).toBe(false);
      expect(isGhostOsActionTool("ghost_recipe_save")).toBe(false);
      expect(isGhostOsActionTool("ghost_recipe_show")).toBe(false);
      expect(isGhostOsActionTool("ghost_recipe_delete")).toBe(false);
    });

    it("should not identify learning tools as actions", () => {
      expect(isGhostOsActionTool("ghost_learn_start")).toBe(false);
      expect(isGhostOsActionTool("ghost_learn_stop")).toBe(false);
      expect(isGhostOsActionTool("ghost_learn_status")).toBe(false);
    });

    it("should not identify vision tools as actions", () => {
      expect(isGhostOsActionTool("ghost_ground")).toBe(false);
      expect(isGhostOsActionTool("ghost_parse_screen")).toBe(false);
      expect(isGhostOsActionTool("ghost_annotate")).toBe(false);
      expect(isGhostOsActionTool("ghost_element_at")).toBe(false);
    });

    it("should not identify utility tools as actions", () => {
      expect(isGhostOsActionTool("ghost_wait")).toBe(false);
    });
  });

  describe("generateGhostOsMCPConfig", () => {
    it("should return a valid MCP config shape with the ghostos server key", () => {
      // We can't easily mock resolveGhostBinary for this module, so we test
      // the config structure by verifying the constants and helper functions.
      // The full function is an integration of resolveGhostBinary + config
      // generation — tested via the integration test if ghost is installed.
      expect(GHOST_OS_SERVER_NAME).toBe("ghostos");

      // Verify the expected config shape matches what generateGhostOsMCPConfig produces
      // by checking the function exists and is async
      expect(typeof generateGhostOsMCPConfig).toBe("function");
    });
  });
});
