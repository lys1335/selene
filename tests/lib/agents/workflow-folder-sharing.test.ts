import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    folders: [] as any[],
    // Separate DB-level arrays for share-folder tests that query other tables.
    workflows: [] as any[],
    workflowMembers: [] as any[],
    workflowByAgentId: new Map<string, any>(),
    membersByWorkflowId: new Map<string, any[]>(),
    workflowById: new Map<string, any>(),
    notifications: [] as Array<{ characterId: string; event: any }>,
  };

  const resetState = () => {
    state.folders = [];
    state.workflows = [];
    state.workflowMembers = [];
    state.workflowByAgentId.clear();
    state.membersByWorkflowId.clear();
    state.workflowById.clear();
    state.notifications = [];
  };

  const cloneRow = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  const makeFolder = (overrides: Partial<any> = {}) => ({
    id: overrides.id ?? crypto.randomUUID(),
    userId: overrides.userId ?? "user-1",
    characterId: overrides.characterId ?? "agent-a",
    folderPath: overrides.folderPath ?? "C:/repo",
    displayName: overrides.displayName ?? "repo",
    isPrimary: overrides.isPrimary ?? false,
    recursive: overrides.recursive ?? true,
    includeExtensions: overrides.includeExtensions ?? ["ts"],
    excludePatterns: overrides.excludePatterns ?? ["node_modules"],
    source: overrides.source ?? "user",
    status: overrides.status ?? "synced",
    lastSyncedAt: overrides.lastSyncedAt ?? null,
    lastError: overrides.lastError ?? null,
    fileCount: overrides.fileCount ?? 0,
    chunkCount: overrides.chunkCount ?? 0,
    embeddingModel: overrides.embeddingModel ?? "text-embedding-3-small",
    indexingMode: overrides.indexingMode ?? "auto",
    syncMode: overrides.syncMode ?? "auto",
    syncCadenceMinutes: overrides.syncCadenceMinutes ?? 60,
    fileTypeFilters: overrides.fileTypeFilters ?? [],
    maxFileSizeBytes: overrides.maxFileSizeBytes ?? 1024,
    chunkPreset: overrides.chunkPreset ?? "balanced",
    chunkSizeOverride: overrides.chunkSizeOverride ?? null,
    chunkOverlapOverride: overrides.chunkOverlapOverride ?? null,
    reindexPolicy: overrides.reindexPolicy ?? "smart",
    skippedCount: overrides.skippedCount ?? 0,
    skipReasons: overrides.skipReasons ?? {},
    lastRunMetadata: overrides.lastRunMetadata ?? {},
    lastRunTrigger: overrides.lastRunTrigger ?? null,
    inheritedFromWorkflowId: overrides.inheritedFromWorkflowId ?? null,
    inheritedFromAgentId: overrides.inheritedFromAgentId ?? null,
    inheritedFromFolderId: overrides.inheritedFromFolderId ?? null,
    updatedAt: overrides.updatedAt ?? "2026-03-13T00:00:00.000Z",
  });

  const evaluateCondition = (condition: any, row: any): boolean => {
    if (!condition) return true;
    switch (condition.kind) {
      case "eq": {
        const rowValue = row[condition.column.name];
        if (Array.isArray(rowValue)) {
          return rowValue.some((value) => value === condition.value);
        }
        return rowValue === condition.value;
      }
      case "ne":
        return row[condition.column.name] !== condition.value;
      case "isNull":
        return row[condition.column.name] == null;
      case "inArray":
        return condition.values.includes(row[condition.column.name]);
      case "and":
        return condition.conditions.every((child: any) => evaluateCondition(child, row));
      default:
        throw new Error(`Unhandled condition kind in test mock: ${condition.kind}`);
    }
  };

  const tableToState: Record<string, () => any[]> = {
    folders: () => state.folders,
    workflows: () => state.workflows,
    workflowMembers: () => state.workflowMembers,
  };

  const rowsFor = (table: any): any[] => {
    if (table && typeof table.__table === "string" && tableToState[table.__table]) {
      return tableToState[table.__table]();
    }
    // Legacy fallback: for existing propagate tests that don't route by table,
    // keep defaulting to folders.
    return state.folders;
  };

  const makeSelectResult = (project?: (row: any) => any) => ({
    from(table?: any) {
      const getRows = () => rowsFor(table);
      return {
        where(condition: any) {
          const filtered = getRows().filter((row) => evaluateCondition(condition, row));
          const projected = filtered.map((row) => (project ? project(row) : row));
          return {
            limit(count: number) {
              return Promise.resolve(projected.slice(0, count).map(cloneRow));
            },
            orderBy() {
              return Promise.resolve(projected.map(cloneRow));
            },
            then(resolve: (value: any[]) => unknown) {
              return Promise.resolve(projected.map(cloneRow)).then(resolve);
            },
          };
        },
        limit(count: number) {
          const projected = getRows().map((row) => (project ? project(row) : row));
          return Promise.resolve(projected.slice(0, count).map(cloneRow));
        },
      };
    },
  });

  const projectSelection = (selection: any, row: any) => {
    if (!selection) return row;
    const projected: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(selection)) {
      projected[key] = row[(column as any).name];
    }
    return projected;
  };

  return {
    state,
    resetState,
    cloneRow,
    makeFolder,
    evaluateCondition,
    makeSelectResult,
    projectSelection,
    refreshWorkflowSharedResources: vi.fn(),
    getWorkflowByAgentId: vi.fn(async (agentId: string) => state.workflowByAgentId.get(agentId) ?? null),
    getWorkflowMembers: vi.fn(async (workflowId: string) => state.membersByWorkflowId.get(workflowId) ?? []),
    getWorkflowById: vi.fn(async (workflowId: string) => state.workflowById.get(workflowId) ?? null),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: any[]) => ({ kind: "and", conditions }),
  eq: (column: any, value: any) => ({ kind: "eq", column, value }),
  ne: (column: any, value: any) => ({ kind: "ne", column, value }),
  inArray: (column: any, values: any[]) => ({ kind: "inArray", column, values }),
  isNull: (column: any) => ({ kind: "isNull", column }),
}));

vi.mock("@/lib/db/sqlite-character-schema", () => ({
  agentSyncFolders: {
    __table: "folders",
    id: { name: "id" },
    userId: { name: "userId" },
    characterId: { name: "characterId" },
    folderPath: { name: "folderPath" },
    source: { name: "source" },
    inheritedFromWorkflowId: { name: "inheritedFromWorkflowId" },
    inheritedFromAgentId: { name: "inheritedFromAgentId" },
    inheritedFromFolderId: { name: "inheritedFromFolderId" },
  },
}));

vi.mock("@/lib/db/sqlite-workflows-schema", () => ({
  agentWorkflows: {
    __table: "workflows",
    id: { name: "id" },
    userId: { name: "userId" },
  },
  agentWorkflowMembers: {
    __table: "workflowMembers",
    workflowId: { name: "workflowId" },
    agentId: { name: "agentId" },
    role: { name: "role" },
  },
}));

vi.mock("@/lib/vectordb/folder-events", () => ({
  notifyFolderChange: (characterId: string, event: any) => {
    mocks.state.notifications.push({ characterId, event });
  },
}));

vi.mock("@/lib/agents/workflow-db-helpers", () => ({
  refreshWorkflowSharedResources: mocks.refreshWorkflowSharedResources,
  getWorkflowByAgentId: mocks.getWorkflowByAgentId,
  getWorkflowMembers: mocks.getWorkflowMembers,
  getWorkflowById: mocks.getWorkflowById,
}));

vi.mock("@/lib/vectordb/sync-service", () => ({
  removeSyncFolder: async (folderId: string) => {
    mocks.state.folders = mocks.state.folders.filter((row) => row.id !== folderId);
  },
}));

vi.mock("@/lib/db/sqlite-client", () => ({
  db: {
    select(selection?: any) {
      return mocks.makeSelectResult(
        (row) => mocks.projectSelection(selection, row)
      );
    },
    insert() {
      return {
        values(values: any) {
          const row = { ...values, id: values.id ?? crypto.randomUUID() };
          mocks.state.folders.push(row);
          return {
            returning() {
              return Promise.resolve([mocks.cloneRow(row)]);
            },
          };
        },
      };
    },
    update() {
      return {
        set(values: any) {
          return {
            where(condition: any) {
              for (const row of mocks.state.folders) {
                if (mocks.evaluateCondition(condition, row)) {
                  Object.assign(row, values);
                }
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete() {
      return {
        where(condition: any) {
          mocks.state.folders = mocks.state.folders.filter((row) => !mocks.evaluateCondition(condition, row));
          return Promise.resolve();
        },
      };
    },
  },
}));

import {
  propagateWorkflowFolderChange,
  shareFolderToWorkflowSubagents,
} from "@/lib/agents/workflow-folder-sharing";

describe("workflow folder propagation", () => {
  beforeEach(() => {
    mocks.resetState();
    mocks.refreshWorkflowSharedResources.mockClear();
    mocks.getWorkflowByAgentId.mockClear();
    mocks.getWorkflowMembers.mockClear();
    mocks.getWorkflowById.mockClear();
  });

  it("propagates newly added own folder to other workflow members", async () => {
    const workflow = { id: "wf-1", initiatorId: "agent-a", status: "active" };
    mocks.state.workflowByAgentId.set("agent-a", { workflow, member: { agentId: "agent-a", role: "initiator" } });
    mocks.state.workflowById.set("wf-1", workflow);
    mocks.state.membersByWorkflowId.set("wf-1", [
      { agentId: "agent-a", role: "initiator" },
      { agentId: "agent-b", role: "subagent" },
      { agentId: "agent-c", role: "subagent" },
    ]);
    mocks.state.folders.push(mocks.makeFolder({ id: "folder-a", characterId: "agent-a", folderPath: "C:/repo" }));

    await propagateWorkflowFolderChange("agent-a", { type: "added", folderId: "folder-a" });

    const inherited = mocks.state.folders.filter((row) => row.inheritedFromAgentId === "agent-a");
    expect(inherited).toHaveLength(2);
    expect(inherited.map((row) => row.characterId).sort()).toEqual(["agent-b", "agent-c"]);
    expect(inherited.every((row) => row.inheritedFromWorkflowId === "wf-1")).toBe(true);
    expect(mocks.refreshWorkflowSharedResources).toHaveBeenCalledWith("wf-1", "agent-a", mocks.getWorkflowById);
  });

  it("does not propagate inherited folders again", async () => {
    const workflow = { id: "wf-1", initiatorId: "agent-a", status: "active" };
    mocks.state.workflowByAgentId.set("agent-b", { workflow, member: { agentId: "agent-b", role: "subagent" } });
    mocks.state.workflowById.set("wf-1", workflow);
    mocks.state.membersByWorkflowId.set("wf-1", [
      { agentId: "agent-a", role: "initiator" },
      { agentId: "agent-b", role: "subagent" },
    ]);
    mocks.state.folders.push(
      mocks.makeFolder({
        id: "inherited-folder",
        characterId: "agent-b",
        folderPath: "C:/repo",
        inheritedFromWorkflowId: "wf-1",
        inheritedFromAgentId: "agent-a",
      })
    );

    await propagateWorkflowFolderChange("agent-b", { type: "added", folderId: "inherited-folder" });

    expect(mocks.state.folders).toHaveLength(1);
    expect(mocks.refreshWorkflowSharedResources).not.toHaveBeenCalled();
  });

  it("removes inherited copies from other members when source folder is removed", async () => {
    const workflow = { id: "wf-1", initiatorId: "agent-a", status: "active" };
    mocks.state.workflowByAgentId.set("agent-a", { workflow, member: { agentId: "agent-a", role: "initiator" } });
    mocks.state.workflowById.set("wf-1", workflow);
    mocks.state.membersByWorkflowId.set("wf-1", [
      { agentId: "agent-a", role: "initiator" },
      { agentId: "agent-b", role: "subagent" },
    ]);
    mocks.state.folders.push(
      mocks.makeFolder({ id: "copy-1", characterId: "agent-b", folderPath: "C:/repo", inheritedFromWorkflowId: "wf-1", inheritedFromAgentId: "agent-a" }),
      mocks.makeFolder({ id: "own-b", characterId: "agent-b", folderPath: "C:/own-b" })
    );

    await propagateWorkflowFolderChange("agent-a", { type: "removed", folderId: "source-folder", folderPath: "C:/repo" });

    expect(mocks.state.folders.map((row) => row.id)).toEqual(["own-b"]);
    // removeSyncFolder handles its own notifications internally,
    // so we only verify the folder was removed and workflow resources refreshed.
    expect(mocks.refreshWorkflowSharedResources).toHaveBeenCalledWith("wf-1", "agent-a", mocks.getWorkflowById);
  });

  it("skips workspace-sourced own folders during propagation", async () => {
    const workflow = { id: "wf-1", initiatorId: "agent-a", status: "active" };
    mocks.state.workflowByAgentId.set("agent-a", { workflow, member: { agentId: "agent-a", role: "initiator" } });
    mocks.state.workflowById.set("wf-1", workflow);
    mocks.state.membersByWorkflowId.set("wf-1", [
      { agentId: "agent-a", role: "initiator" },
      { agentId: "agent-b", role: "subagent" },
    ]);
    // Own folder is workspace-sourced (a git worktree path grant) — should NOT
    // be propagated, because worktrees belong to the owning agent only.
    mocks.state.folders.push(
      mocks.makeFolder({
        id: "workspace-folder",
        characterId: "agent-a",
        folderPath: "/tmp/worktrees/feature-x",
        source: "workspace",
      })
    );

    await propagateWorkflowFolderChange("agent-a", { type: "added", folderId: "workspace-folder" });

    // No inherited copies were created on agent-b.
    const inherited = mocks.state.folders.filter((row) => row.inheritedFromAgentId === "agent-a");
    expect(inherited).toHaveLength(0);
  });

  it("updates inherited copies when source folder settings change", async () => {
    const workflow = { id: "wf-1", initiatorId: "agent-a", status: "active" };
    mocks.state.workflowByAgentId.set("agent-a", { workflow, member: { agentId: "agent-a", role: "initiator" } });
    mocks.state.workflowById.set("wf-1", workflow);
    mocks.state.membersByWorkflowId.set("wf-1", [
      { agentId: "agent-a", role: "initiator" },
      { agentId: "agent-b", role: "subagent" },
    ]);
    mocks.state.folders.push(
      mocks.makeFolder({ id: "folder-a", characterId: "agent-a", folderPath: "C:/repo", displayName: "new-name", recursive: false, includeExtensions: ["md"] }),
      mocks.makeFolder({ id: "copy-1", characterId: "agent-b", folderPath: "C:/repo", displayName: "old-name", recursive: true, includeExtensions: ["ts"], inheritedFromWorkflowId: "wf-1", inheritedFromAgentId: "agent-a" })
    );

    await propagateWorkflowFolderChange("agent-a", { type: "updated", folderId: "folder-a" });

    const copy = mocks.state.folders.find((row) => row.id === "copy-1");
    expect(copy?.displayName).toBe("new-name");
    expect(copy?.recursive).toBe(false);
    expect(copy?.includeExtensions).toEqual(["md"]);
    expect(mocks.state.notifications).toContainEqual({
      characterId: "agent-b",
      event: { type: "updated", folderId: "copy-1" },
    });
    expect(mocks.refreshWorkflowSharedResources).toHaveBeenCalledWith("wf-1", "agent-a", mocks.getWorkflowById);
  });

});

describe("shareFolderToWorkflowSubagents", () => {
  beforeEach(() => {
    mocks.resetState();
  });

  it("rejects workspace-sourced folders with a clear error", async () => {
    mocks.state.workflows.push({ id: "wf-1", userId: "user-1" });
    mocks.state.workflowMembers.push(
      { workflowId: "wf-1", agentId: "agent-a", role: "initiator" },
      { workflowId: "wf-1", agentId: "agent-b", role: "subagent" }
    );
    mocks.state.folders.push(
      mocks.makeFolder({
        id: "workspace-folder",
        characterId: "agent-a",
        folderPath: "/tmp/worktrees/feature-x",
        source: "workspace",
      })
    );

    await expect(
      shareFolderToWorkflowSubagents({
        workflowId: "wf-1",
        folderId: "workspace-folder",
        userId: "user-1",
      })
    ).rejects.toThrow("Workspace folders cannot be shared to workflow members");

    // No clone created on agent-b
    const inherited = mocks.state.folders.filter((row) => row.inheritedFromAgentId);
    expect(inherited).toHaveLength(0);
  });

  it("allows sharing a normal user folder to subagents", async () => {
    mocks.state.workflows.push({ id: "wf-1", userId: "user-1" });
    mocks.state.workflowMembers.push(
      { workflowId: "wf-1", agentId: "agent-a", role: "initiator" },
      { workflowId: "wf-1", agentId: "agent-b", role: "subagent" }
    );
    mocks.state.folders.push(
      mocks.makeFolder({
        id: "user-folder",
        characterId: "agent-a",
        folderPath: "C:/docs",
        source: "user",
      })
    );

    const result = await shareFolderToWorkflowSubagents({
      workflowId: "wf-1",
      folderId: "user-folder",
      userId: "user-1",
    });

    expect(result.syncedCount).toBe(1);
    expect(result.subAgentIds).toEqual(["agent-b"]);
    const inherited = mocks.state.folders.filter((row) => row.inheritedFromAgentId === "agent-a");
    expect(inherited).toHaveLength(1);
    expect(inherited[0].characterId).toBe("agent-b");
  });
});
