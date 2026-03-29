/**
 * Ghost OS MCP Configuration
 *
 * Generates MCP server configuration for Ghost OS when the binary is detected.
 * Integrates with Selene's MCP config pipeline.
 */

import type { GhostOsMCPConfig } from "./types";
import { resolveGhostBinary } from "./setup";

/**
 * Cached Ghost OS binary path and config.
 * Avoids shelling out to `which` on every chat request / API call.
 * Cache is per-process and resets on restart.
 */
let _cachedBinaryPath: string | null | undefined; // undefined = not yet checked
let _cachedConfig: GhostOsMCPConfig | null | undefined;

/**
 * Generate MCP server configuration for Ghost OS.
 * Returns null if Ghost OS is not installed.
 * Result is cached per-process to avoid repeated binary lookups.
 */
export async function generateGhostOsMCPConfig(): Promise<GhostOsMCPConfig | null> {
  if (_cachedConfig !== undefined) return _cachedConfig;

  const binaryPath = await resolveGhostBinary();
  _cachedBinaryPath = binaryPath;

  if (!binaryPath) {
    _cachedConfig = null;
    return null;
  }

  _cachedConfig = {
    mcpServers: {
      ghostos: {
        type: "stdio",
        command: binaryPath,
        args: ["--mcp"],
        enabled: true,
      },
    },
  };
  return _cachedConfig;
}

/**
 * Get the Ghost OS MCP server config as a flat Record for merging into combinedConfig.
 * Returns empty object if Ghost OS is not installed.
 * This is the primary integration point for chat-integration.ts and API routes.
 */
export async function getGhostOsServerConfig(): Promise<Record<string, { type: string; command: string; args: string[]; enabled: boolean }>> {
  const config = await generateGhostOsMCPConfig();
  if (!config) return {};
  return config.mcpServers;
}

/** Clear the cached config (for testing or when installation state changes) */
export function clearGhostOsConfigCache(): void {
  _cachedBinaryPath = undefined;
  _cachedConfig = undefined;
}

/**
 * Get the Ghost OS MCP server name used for tool ID generation.
 * This must match the key in the mcpServers config.
 */
export const GHOST_OS_SERVER_NAME = "ghostos";

/**
 * Check if a tool ID belongs to the Ghost OS MCP server.
 */
export function isGhostOsTool(toolId: string): boolean {
  return toolId.startsWith("mcp_ghostos_");
}

/**
 * Ghost OS action tools — these modify desktop state and may conflict between agents.
 * Module-scoped to avoid allocating a new Set on every call.
 *
 * Comprehensive list covering all Ghost OS tools that perform actions
 * (as opposed to perception/read-only tools like ghost_context, ghost_state, etc.).
 */
const GHOST_OS_ACTION_TOOLS = new Set([
  // Core input actions
  "ghost_click",
  "ghost_type",
  "ghost_press",
  "ghost_hotkey",
  "ghost_scroll",
  "ghost_hover",
  "ghost_drag",
  "ghost_long_press",
  // Window management actions
  "ghost_focus",
  "ghost_window",
  // Advanced/extended actions (may be added by Ghost OS in future versions)
  "ghost_double_click",
  "ghost_right_click",
  "ghost_select",
  "ghost_write",
  "ghost_resize",
  // Recipe execution (modifies state by running automation)
  "ghost_run",
]);

/**
 * Check if a tool name is a Ghost OS action tool (vs perception/recipe/learning tool).
 * Action tools are the ones that modify state and may conflict between agents.
 *
 * Perception tools (ghost_context, ghost_state, ghost_find, ghost_read, ghost_inspect,
 * ghost_screenshot, ghost_annotate, ghost_ground, ghost_parse_screen, ghost_element_at,
 * ghost_wait) are safe to run concurrently.
 *
 * Recipe management tools (ghost_recipes, ghost_recipe_show, ghost_recipe_save,
 * ghost_recipe_delete) are also safe — they only read/write recipe JSON files.
 *
 * Learning tools (ghost_learn_start, ghost_learn_stop, ghost_learn_status) are observers
 * and don't conflict with actions. NOTE: ghost_learn_start does capture a global CGEvent
 * tap — concurrent learning sessions from multiple agents would conflict, but this is a
 * Phase 3 concern (learning mode not yet exposed).
 */
export function isGhostOsActionTool(toolName: string): boolean {
  return GHOST_OS_ACTION_TOOLS.has(toolName);
}
