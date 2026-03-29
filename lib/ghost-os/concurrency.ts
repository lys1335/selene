/**
 * Ghost OS Multi-Agent Concurrency Detection
 *
 * Tracks active Ghost OS operations across agents and injects warnings
 * when multiple agents attempt concurrent desktop control.
 *
 * Strategy: awareness-based (warn, don't block). Agents decide whether
 * to proceed or wait based on the warning.
 *
 * TODO(Phase 1.1): Wire wrapGhostOsExecution into the MCP tool execution
 * pipeline via tools-builder.ts or mcp-tool-adapter.ts. Currently exported
 * and fully tested but not yet called from the runtime path.
 */

import { randomUUID } from "crypto";
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
 * Default TTL for action tools (60s). Most actions complete in <5s.
 * ghost_run (recipe execution) gets a longer TTL since recipes can
 * involve multi-step workflows.
 */
const DEFAULT_STALE_THRESHOLD_MS = 60_000;
const RECIPE_STALE_THRESHOLD_MS = 300_000; // 5 minutes for ghost_run

/**
 * Get the stale threshold for a given tool name.
 * ghost_run gets a longer TTL since recipe execution can take minutes.
 */
function getStaleThreshold(toolName: string): number {
  return toolName === "ghost_run"
    ? RECIPE_STALE_THRESHOLD_MS
    : DEFAULT_STALE_THRESHOLD_MS;
}

/**
 * Get the currently active Ghost OS operation, if any.
 * Automatically clears stale operations (older than tool-specific TTL).
 */
export function getActiveGhostOsOperation(): GhostOsActiveOperation | undefined {
  const op = globalThis.__ghostOsActiveOp;
  if (op && Date.now() - op.startedAt > getStaleThreshold(op.toolName)) {
    // Auto-clear stale operation (hung tool, crashed subprocess, etc.)
    globalThis.__ghostOsActiveOp = undefined;
    return undefined;
  }
  return op;
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
 * When called with an opId, only clears if the current operation matches —
 * prevents one invocation from clearing another's tracking state.
 * When called without arguments, unconditionally clears (for cleanup/tests).
 */
export function clearActiveGhostOsOperation(opId?: string): void {
  if (opId) {
    const current = globalThis.__ghostOsActiveOp;
    if (current?.opId === opId) {
      globalThis.__ghostOsActiveOp = undefined;
    }
  } else {
    globalThis.__ghostOsActiveOp = undefined;
  }
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
  // Guard against empty string rootSessionId which would falsely suppress warnings
  if (rootSessionId && active.rootSessionId && active.rootSessionId === rootSessionId) {
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
 * Uses a unique opId per invocation to safely handle concurrent async
 * executions from the same agent — only the specific invocation that set
 * the operation will clear it.
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
      // Generate unique ID for this specific invocation
      const opId = randomUUID();

      // Only track action tools in the active operation
      if (isGhostOsActionTool(toolName)) {
        setActiveGhostOsOperation({
          opId,
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
        // Only clear if THIS specific invocation's operation is still the active one.
        // Uses opId-scoped clear to prevent concurrent executions from clearing
        // each other's tracking state.
        clearActiveGhostOsOperation(opId);
      }
    },
  };
}
