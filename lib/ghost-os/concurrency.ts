/**
 * Ghost OS Multi-Agent Concurrency Detection
 *
 * Tracks active Ghost OS operations across agents and injects warnings
 * when multiple agents attempt concurrent desktop control.
 *
 * Strategy: awareness-based (warn, don't block). Agents decide whether
 * to proceed or wait based on the warning.
 */

import type { GhostOsActiveOperation } from "./types";
import { GHOST_OS_SERVER_NAME, isGhostOsActionTool } from "./config";

// ---------------------------------------------------------------------------
// Global state — persists across hot reloads
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __ghostOsActiveOp: GhostOsActiveOperation | undefined;
}

/**
 * Get the currently active Ghost OS operation, if any.
 */
export function getActiveGhostOsOperation(): GhostOsActiveOperation | undefined {
  return globalThis.__ghostOsActiveOp;
}

/**
 * Set the active Ghost OS operation.
 * Called before executing a Ghost OS tool.
 */
export function setActiveGhostOsOperation(op: GhostOsActiveOperation): void {
  globalThis.__ghostOsActiveOp = op;
}

/**
 * Clear the active Ghost OS operation.
 * Called after a Ghost OS tool completes (success or error).
 */
export function clearActiveGhostOsOperation(): void {
  globalThis.__ghostOsActiveOp = undefined;
}

/**
 * Check if a tool execution should receive a concurrency warning.
 * Returns a warning message if another agent is currently using Ghost OS,
 * or null if no conflict detected.
 *
 * @param serverName - MCP server name for the tool being executed
 * @param toolName - Tool name being executed (e.g., "ghost_click")
 * @param characterId - Current agent's character ID
 * @param characterName - Current agent's display name
 * @param rootSessionId - Root session ID for delegation chain grouping
 */
export function checkGhostOsConcurrency(
  serverName: string,
  toolName: string,
  characterId: string,
  characterName: string,
  rootSessionId: string,
): string | null {
  // Only check Ghost OS server tools
  if (serverName !== GHOST_OS_SERVER_NAME) {
    return null;
  }

  // Only warn for action tools (perception tools are safe to run concurrently)
  if (!isGhostOsActionTool(toolName)) {
    return null;
  }

  const active = getActiveGhostOsOperation();
  if (!active) {
    return null;
  }

  // Same agent's sequential calls — no conflict
  if (active.characterId === characterId) {
    return null;
  }

  // Same delegation chain (root session) — cooperative access, no conflict
  if (active.rootSessionId === rootSessionId) {
    return null;
  }

  // Different agent, different delegation chain — conflict detected
  const elapsed = Math.round((Date.now() - active.startedAt) / 1000);
  return (
    `\u26a0\ufe0f Another agent ("${active.characterName}") is currently using Ghost OS ` +
    `(running ${active.toolName} for ${elapsed}s). ` +
    `Your action may conflict with theirs. Consider waiting or coordinating.`
  );
}

/**
 * Wrap a Ghost OS tool execution with concurrency tracking.
 * Sets the active operation before execution and clears it after.
 *
 * @returns An object with:
 *   - `warning`: concurrency warning (null if no conflict)
 *   - `execute`: function to wrap the actual tool execution with tracking
 */
export function wrapGhostOsExecution(
  serverName: string,
  toolName: string,
  characterId: string,
  characterName: string,
  rootSessionId: string,
): {
  warning: string | null;
  execute: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  // Only track Ghost OS tools
  if (serverName !== GHOST_OS_SERVER_NAME) {
    return {
      warning: null,
      execute: (fn) => fn(),
    };
  }

  const warning = checkGhostOsConcurrency(
    serverName,
    toolName,
    characterId,
    characterName,
    rootSessionId,
  );

  return {
    warning,
    execute: async <T>(fn: () => Promise<T>): Promise<T> => {
      // Only track action tools in the active operation
      if (isGhostOsActionTool(toolName)) {
        setActiveGhostOsOperation({
          characterId,
          characterName,
          toolName,
          rootSessionId,
          startedAt: Date.now(),
        });
      }

      try {
        return await fn();
      } finally {
        // Clear if this agent's operation is still the active one
        const current = getActiveGhostOsOperation();
        if (current?.characterId === characterId && current?.toolName === toolName) {
          clearActiveGhostOsOperation();
        }
      }
    },
  };
}
