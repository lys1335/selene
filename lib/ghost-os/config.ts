/**
 * Ghost OS MCP Configuration
 *
 * Generates MCP server configuration for Ghost OS when the binary is detected.
 * Integrates with Selene's MCP config pipeline.
 */

import type { GhostOsMCPConfig } from "./types";
import { resolveGhostBinary } from "./setup";

/**
 * Generate MCP server configuration for Ghost OS.
 * Returns null if Ghost OS is not installed.
 */
export async function generateGhostOsMCPConfig(): Promise<GhostOsMCPConfig | null> {
  const binaryPath = await resolveGhostBinary();

  if (!binaryPath) {
    return null;
  }

  return {
    mcpServers: {
      ghostos: {
        type: "stdio",
        command: binaryPath,
        args: ["--mcp"],
        enabled: true,
      },
    },
  };
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
 * Check if a tool name is a Ghost OS action tool (vs perception/recipe tool).
 * Action tools are the ones that modify state and may conflict between agents.
 */
export function isGhostOsActionTool(toolName: string): boolean {
  const actionTools = new Set([
    "ghost_click",
    "ghost_type",
    "ghost_press",
    "ghost_hotkey",
    "ghost_scroll",
    "ghost_hover",
    "ghost_drag",
    "ghost_long_press",
    "ghost_focus",
    "ghost_window",
  ]);
  return actionTools.has(toolName);
}
