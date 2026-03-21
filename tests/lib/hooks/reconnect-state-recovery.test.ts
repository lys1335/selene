/**
 * Reconnect State Recovery Tests
 *
 * Verifies that after SSE reconnection, active task state is properly
 * reconciled between the task store, session sync store, and the UI.
 *
 * Covers:
 * - Stale running tasks are cleared when server says no active run
 * - Active runs are preserved and re-armed when server confirms still running
 * - Session-scoped isolation: tasks from session A don't leak into session B
 * - Ghost-session prevention: reconciliation clears phantom active runs
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  reconcileTaskSnapshotWithStores,
  buildReconciledCompletionEvent,
} from "@/lib/hooks/use-task-notifications";
import { useUnifiedTasksStore } from "@/lib/stores/unified-tasks-store";
import { useSessionSyncStore } from "@/lib/stores/session-sync-store";
import type { UnifiedTask, TaskEvent } from "@/lib/background-tasks/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeChatTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return {
    type: "chat",
    runId: `run-${crypto.randomUUID().slice(0, 8)}`,
    userId: "user-1",
    characterId: "agent-1",
    sessionId: "session-1",
    status: "running",
    startedAt: new Date().toISOString(),
    pipelineName: "chat",
    metadata: {},
    ...overrides,
  } as UnifiedTask;
}

function makeScheduledTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return makeChatTask({
    type: "scheduled",
    triggerType: "scheduled",
    metadata: { scheduledRunId: "sched-1" },
    ...overrides,
  });
}

function resetStores() {
  useUnifiedTasksStore.setState({
    tasks: [],
    tasksMap: new Map(),
    recentlyCompleted: [],
  });
  useSessionSyncStore.setState({
    sessionsById: new Map(),
    sessionsByCharacter: new Map(),
    activeRuns: new Map(),
    sessionActivityById: new Map(),
    sessionContextStatusById: new Map(),
    lastRefreshAt: Date.now(),
    listeners: new Set(),
  });
}

interface ReconcileCallbacks {
  addTask: (task: UnifiedTask) => void;
  updateTask: (runId: string, updates: Partial<UnifiedTask>) => void;
  completeTask: (task: UnifiedTask) => void;
  dispatchTaskReconciledEvent: (event: Extract<TaskEvent, { eventType: "task:completed" }>) => void;
  reconciledEvents: Array<ReturnType<typeof buildReconciledCompletionEvent>>;
}

function makeCallbacks(): ReconcileCallbacks {
  const store = useUnifiedTasksStore.getState();
  const reconciledEvents: Array<ReturnType<typeof buildReconciledCompletionEvent>> = [];
  return {
    addTask: store.addTask,
    updateTask: store.updateTask,
    completeTask: store.completeTask,
    dispatchTaskReconciledEvent: (event) => reconciledEvents.push(event),
    reconciledEvents,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("reconnect state recovery", () => {
  beforeEach(resetStores);

  describe("stale running task cleanup after reconnect", () => {
    it("clears a locally-tracked running task when server reports no active tasks", () => {
      const task = makeChatTask({ runId: "run-stale", sessionId: "session-1" });
      const store = useUnifiedTasksStore.getState();
      const syncStore = useSessionSyncStore.getState();

      // Pre-disconnect state: client was tracking a running task
      store.addTask(task);
      syncStore.setActiveRun("session-1", "run-stale");
      syncStore.setSessionActivity("session-1", {
        sessionId: "session-1",
        runId: "run-stale",
        indicators: [{ key: "run", kind: "run", label: "Running", tone: "info" }],
        isRunning: true,
        updatedAt: Date.now(),
      });

      // Verify pre-state
      expect(useUnifiedTasksStore.getState().tasks).toHaveLength(1);
      expect(useSessionSyncStore.getState().activeRuns.has("session-1")).toBe(true);

      // Reconnect: server says no active tasks
      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [], // empty — server has no active tasks
        callbacks
      );

      // Task should be removed from store
      expect(useUnifiedTasksStore.getState().tasks).toHaveLength(0);
      expect(useUnifiedTasksStore.getState().tasksMap.has("run-stale")).toBe(false);

      // Active run should be cleared
      expect(useSessionSyncStore.getState().activeRuns.has("session-1")).toBe(false);
      expect(useSessionSyncStore.getState().getSessionActivity("session-1")).toBeUndefined();

      // Plain chat tasks don't dispatch lifecycle reconciled events
      // (only scheduled/delegation tasks do via isBackgroundLifecycleTask)
      expect(callbacks.reconciledEvents).toHaveLength(0);
    });

    it("preserves a running task when server confirms it is still active", () => {
      const task = makeChatTask({ runId: "run-active", sessionId: "session-1" });
      const store = useUnifiedTasksStore.getState();
      const syncStore = useSessionSyncStore.getState();

      store.addTask(task);
      syncStore.setActiveRun("session-1", "run-active");

      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [task], // server confirms the task is still running
        callbacks
      );

      // Task should still be present
      expect(useUnifiedTasksStore.getState().tasks).toHaveLength(1);
      expect(useUnifiedTasksStore.getState().tasksMap.has("run-active")).toBe(true);

      // Active run should still be set
      expect(useSessionSyncStore.getState().activeRuns.get("session-1")).toBe("run-active");

      // No reconciled events (task is still running)
      expect(callbacks.reconciledEvents).toHaveLength(0);
    });
  });

  describe("session-scoped isolation during reconciliation", () => {
    it("does not clear session-A active run when session-B task is removed", () => {
      const taskA = makeChatTask({ runId: "run-A", sessionId: "session-A" });
      const taskB = makeChatTask({ runId: "run-B", sessionId: "session-B" });
      const store = useUnifiedTasksStore.getState();
      const syncStore = useSessionSyncStore.getState();

      store.addTask(taskA);
      store.addTask(taskB);
      syncStore.setActiveRun("session-A", "run-A");
      syncStore.setActiveRun("session-B", "run-B");

      // Server says only session-A's task is still running
      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [taskA],
        callbacks
      );

      // Session A should still have its active run
      expect(useSessionSyncStore.getState().activeRuns.get("session-A")).toBe("run-A");
      expect(useSessionSyncStore.getState().activeRuns.has("session-B")).toBe(false);

      // Task B was removed; plain chat tasks don't dispatch lifecycle events
      expect(useUnifiedTasksStore.getState().tasksMap.has("run-B")).toBe(false);
    });

    it("clears only the correct session's activity when multiple sessions have active runs", () => {
      const taskA = makeChatTask({ runId: "run-A", sessionId: "session-A" });
      const taskB = makeChatTask({ runId: "run-B", sessionId: "session-B" });
      const taskC = makeChatTask({ runId: "run-C", sessionId: "session-C" });
      const store = useUnifiedTasksStore.getState();
      const syncStore = useSessionSyncStore.getState();

      store.addTask(taskA);
      store.addTask(taskB);
      store.addTask(taskC);
      syncStore.setActiveRun("session-A", "run-A");
      syncStore.setActiveRun("session-B", "run-B");
      syncStore.setActiveRun("session-C", "run-C");
      syncStore.setSessionActivity("session-A", {
        sessionId: "session-A",
        runId: "run-A",
        indicators: [{ key: "run", kind: "run", label: "Running", tone: "info" }],
        isRunning: true,
        updatedAt: Date.now(),
      });
      syncStore.setSessionActivity("session-B", {
        sessionId: "session-B",
        runId: "run-B",
        indicators: [{ key: "run", kind: "run", label: "Running", tone: "info" }],
        isRunning: true,
        updatedAt: Date.now(),
      });
      syncStore.setSessionActivity("session-C", {
        sessionId: "session-C",
        runId: "run-C",
        indicators: [{ key: "run", kind: "run", label: "Running", tone: "info" }],
        isRunning: true,
        updatedAt: Date.now(),
      });

      // Server: only session-B is still running
      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [taskB],
        callbacks
      );

      // Session B preserved
      expect(useSessionSyncStore.getState().activeRuns.get("session-B")).toBe("run-B");
      expect(useSessionSyncStore.getState().getSessionActivity("session-B")?.isRunning).toBe(true);

      // Sessions A and C cleared
      expect(useSessionSyncStore.getState().activeRuns.has("session-A")).toBe(false);
      expect(useSessionSyncStore.getState().activeRuns.has("session-C")).toBe(false);
      expect(useSessionSyncStore.getState().getSessionActivity("session-A")).toBeUndefined();
      expect(useSessionSyncStore.getState().getSessionActivity("session-C")).toBeUndefined();
    });
  });

  describe("ghost-session prevention", () => {
    it("clears phantom active runs that exist in session-sync but not in task store", () => {
      const syncStore = useSessionSyncStore.getState();

      // Ghost state: session-sync has an active run but task store is empty
      syncStore.setActiveRun("session-ghost", "run-ghost");
      syncStore.setSessionActivity("session-ghost", {
        sessionId: "session-ghost",
        runId: "run-ghost",
        indicators: [{ key: "run", kind: "run", label: "Running", tone: "info" }],
        isRunning: true,
        updatedAt: Date.now(),
      });

      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        [], // no local tasks
        [], // no server tasks
        callbacks
      );

      // Ghost active run should be cleared
      expect(useSessionSyncStore.getState().activeRuns.has("session-ghost")).toBe(false);
      expect(useSessionSyncStore.getState().getSessionActivity("session-ghost")).toBeUndefined();
    });

    it("replaces a ghost run with the correct run when server reports a different runId", () => {
      const store = useUnifiedTasksStore.getState();
      const syncStore = useSessionSyncStore.getState();

      // Ghost state: client thinks run-old is active
      const oldTask = makeChatTask({ runId: "run-old", sessionId: "session-1" });
      store.addTask(oldTask);
      syncStore.setActiveRun("session-1", "run-old");

      // Server says run-new is the actual active run
      const newTask = makeChatTask({ runId: "run-new", sessionId: "session-1" });

      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [newTask],
        callbacks
      );

      // Old task should be reconciled out
      expect(useUnifiedTasksStore.getState().tasksMap.has("run-old")).toBe(false);

      // New task should be tracked
      expect(useUnifiedTasksStore.getState().tasksMap.has("run-new")).toBe(true);
      expect(useSessionSyncStore.getState().activeRuns.get("session-1")).toBe("run-new");
    });
  });

  describe("reconnect with mixed task types", () => {
    it("handles scheduled + chat tasks across sessions correctly", () => {
      const chatTask = makeChatTask({ runId: "run-chat", sessionId: "session-1" });
      const scheduledTask = makeScheduledTask({ runId: "run-sched", sessionId: "session-2" });
      const store = useUnifiedTasksStore.getState();
      const syncStore = useSessionSyncStore.getState();

      store.addTask(chatTask);
      store.addTask(scheduledTask);
      syncStore.setActiveRun("session-1", "run-chat");
      syncStore.setActiveRun("session-2", "run-sched");

      // Server: scheduled task completed, chat task still running
      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [chatTask],
        callbacks
      );

      // Chat task preserved
      expect(useSessionSyncStore.getState().activeRuns.get("session-1")).toBe("run-chat");

      // Scheduled task cleared
      expect(useSessionSyncStore.getState().activeRuns.has("session-2")).toBe(false);

      // Scheduled tasks ARE background lifecycle tasks → dispatches event
      expect(callbacks.reconciledEvents).toHaveLength(1);
      expect(callbacks.reconciledEvents[0].task.runId).toBe("run-sched");
    });

    it("does not fire reconciled events for plain foreground chat tasks", () => {
      const task = makeChatTask({ runId: "run-fg", sessionId: "session-1" });
      const store = useUnifiedTasksStore.getState();

      store.addTask(task);

      const callbacks = makeCallbacks();
      reconcileTaskSnapshotWithStores(
        useUnifiedTasksStore.getState().tasks,
        [], // server says completed
        callbacks
      );

      // Plain chat task is NOT a background lifecycle task
      expect(callbacks.reconciledEvents).toHaveLength(0);
      // But the task itself should still be cleaned up
      expect(useUnifiedTasksStore.getState().tasksMap.has("run-fg")).toBe(false);
    });
  });
});
