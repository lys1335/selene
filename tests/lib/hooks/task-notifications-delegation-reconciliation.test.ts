import { beforeEach, describe, expect, it } from "vitest";

import {
  buildReconciledCompletionEvent,
  reconcileTaskSnapshotWithStores,
} from "@/lib/hooks/use-task-notifications";
import { useUnifiedTasksStore } from "@/lib/stores/unified-tasks-store";
import { useSessionSyncStore } from "@/lib/stores/session-sync-store";
import type { UnifiedTask } from "@/lib/background-tasks/types";

function makeDelegationTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return {
    type: "chat",
    runId: "run-delegation-1",
    userId: "user-1",
    characterId: "agent-sub",
    sessionId: "session-child-1",
    status: "running",
    startedAt: new Date().toISOString(),
    pipelineName: "chat",
    triggerType: "delegation",
    metadata: {
      isDelegation: true,
      parentAgentId: "agent-init",
      workflowId: "wf-1",
    },
    ...overrides,
  } as UnifiedTask;
}

describe("delegation task reconciliation", () => {
  beforeEach(() => {
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
  });

  it("builds a completed reconciliation event for a delegated chat task", () => {
    const task = makeDelegationTask();
    const event = buildReconciledCompletionEvent(task);

    expect(event.eventType).toBe("task:completed");
    expect(event.task.status).toBe("cancelled");
    expect(event.task.metadata).toMatchObject({
      isDelegation: true,
      parentAgentId: "agent-init",
      workflowId: "wf-1",
    });
    expect(event.task.completedAt).toBeTruthy();
  });

  it("removes delegated tasks from active task state as soon as task completion is reconciled", () => {
    const task = makeDelegationTask();
    const store = useUnifiedTasksStore.getState();
    const syncStore = useSessionSyncStore.getState();
    const reconciledEvents: Array<ReturnType<typeof buildReconciledCompletionEvent>> = [];

    store.addTask(task);
    syncStore.setActiveRun(task.sessionId!, task.runId);
    syncStore.setSessionActivity(task.sessionId!, {
      sessionId: task.sessionId!,
      runId: task.runId,
      indicators: [
        {
          key: "delegation",
          kind: "delegation",
          label: "Delegating",
          tone: "info",
        },
      ],
      isRunning: true,
      updatedAt: Date.now(),
    });

    reconcileTaskSnapshotWithStores(useUnifiedTasksStore.getState().tasks, [], {
      addTask: store.addTask,
      updateTask: store.updateTask,
      completeTask: store.completeTask,
      dispatchTaskReconciledEvent: (event) => reconciledEvents.push(event),
    });

    expect(useUnifiedTasksStore.getState().tasks).toEqual([]);
    expect(useUnifiedTasksStore.getState().tasksMap.has(task.runId)).toBe(false);
    expect(useUnifiedTasksStore.getState().recentlyCompleted[0]).toMatchObject({
      runId: task.runId,
      metadata: {
        isDelegation: true,
        parentAgentId: "agent-init",
        workflowId: "wf-1",
      },
    });
    expect(useSessionSyncStore.getState().activeRuns.has(task.sessionId!)).toBe(false);
    expect(useSessionSyncStore.getState().getSessionActivity(task.sessionId!)).toMatchObject({
      runId: task.runId,
      isRunning: false,
    });
    expect(
      useSessionSyncStore
        .getState()
        .getSessionActivity(task.sessionId!)
        ?.indicators.some((indicator) => indicator.key === "cancelled")
    ).toBe(true);
    expect(reconciledEvents).toHaveLength(1);
    expect(reconciledEvents[0].task.runId).toBe(task.runId);
    expect(reconciledEvents[0].task.metadata).toMatchObject({
      isDelegation: true,
      parentAgentId: "agent-init",
      workflowId: "wf-1",
    });
  });
});
