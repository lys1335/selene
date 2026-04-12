import { getActiveDelegationsForCharacter } from "@/lib/ai/tools/delegate-to-subagent-tool";
import { getBackgroundProcess } from "@/lib/command-execution";

// ── Session-scoped background task registry ──────────────────────────────
// Tracks which background process IDs were started in each session,
// so prepareStep can keep the turn alive while they run.
// Key: `${characterId}:${sessionId}`, Value: Set of processIds
const sessionBackgroundTasks = new Map<string, Set<string>>();

function sessionKey(characterId: string, sessionId: string): string {
  return `${characterId}:${sessionId}`;
}

/**
 * Register a background process ID as belonging to a session.
 * Called from executeCommand tool after a background process starts.
 */
export function registerBackgroundTask(
  characterId: string,
  sessionId: string,
  processId: string,
): void {
  const key = sessionKey(characterId, sessionId);
  let tasks = sessionBackgroundTasks.get(key);
  if (!tasks) {
    tasks = new Set();
    sessionBackgroundTasks.set(key, tasks);
  }
  tasks.add(processId);
}

/**
 * Check if a session has any background processes still running.
 * Cleans up finished processes from the registry as a side effect.
 */
export function hasRunningBackgroundTasksForSession(
  characterId: string | null,
  sessionId: string,
): boolean {
  if (!characterId) return false;

  const key = sessionKey(characterId, sessionId);
  const tasks = sessionBackgroundTasks.get(key);
  if (!tasks || tasks.size === 0) return false;

  // Check each registered process — clean up finished ones
  for (const processId of tasks) {
    const info = getBackgroundProcess(processId);
    if (!info || !info.running) {
      tasks.delete(processId);
    }
  }

  // Clean up empty sets
  if (tasks.size === 0) {
    sessionBackgroundTasks.delete(key);
    return false;
  }

  return true;
}

// ── Delegation helpers ───────────────────────────────────────────────────

export function hasRunningDelegationsForSession(
  characterId: string | null,
  initiatorSessionId: string,
): boolean {
  if (!characterId) {
    return false;
  }

  return getActiveDelegationsForCharacter(characterId, initiatorSessionId).some(
    (delegation) => delegation.running,
  );
}

export function hasDelegationsForSession(
  characterId: string | null,
  initiatorSessionId: string,
): boolean {
  if (!characterId) {
    return false;
  }

  return getActiveDelegationsForCharacter(characterId, initiatorSessionId).length > 0;
}

// ── Turn control ─────────────────────────────────────────────────────────

/**
 * Check if the turn has async work (delegations or background tasks) still running.
 */
export function hasActiveAsyncWork(
  characterId: string | null,
  sessionId: string,
): boolean {
  return (
    hasRunningDelegationsForSession(characterId, sessionId) ||
    hasRunningBackgroundTasksForSession(characterId, sessionId)
  );
}

export function shouldStopTurn(input: {
  characterId: string | null;
  initiatorSessionId: string;
  stepCount: number;
  maxSteps: number;
  provider?: string;
}): boolean {
  if (input.stepCount >= input.maxSteps) {
    return true;
  }

  // Claude Code Agent SDK handles tool execution internally — its SSE
  // response includes tool_use blocks (Read, Edit, Bash, etc.) from those
  // internal executions. The AI SDK sees them, can't match them to Selene
  // tools, and would continue to a second step — triggering another Claude
  // Code SDK query that produces a duplicate response.
  //
  // Stop after the initial step UNLESS there's active async work
  // (delegations or background tasks) that needs the turn alive.
  // Delegations block in prepareStep waiting for results; background
  // tasks need follow-up steps to check status.
  if (input.provider === "claudecode" && input.stepCount > 0) {
    return !hasActiveAsyncWork(input.characterId, input.initiatorSessionId);
  }

  // For other providers, never force-stop. The AI SDK loop ends naturally
  // when the model stops making tool calls (outputs text-only response).
  // prepareStep sets toolChoice="required" while async work is in-flight.
  return false;
}
