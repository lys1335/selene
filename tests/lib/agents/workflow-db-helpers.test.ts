import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    folders: [] as any[],
    workflowMembers: [] as any[],
    pluginAssignments: [] as any[],
    plugins: [] as any[],
  };

  const resetState = () => {
    state.folders = [];
    state.workflowMembers = [];
    state.pluginAssignments = [];
    state.plugins = [];
  };

  const makeFolder = (overrides: Partial<any> = {}) => ({
    id: overrides.id ?? crypto.randomUUID(),
    userId: overrides.userId ?? "user-1",
    characterId: overrides.characterId ?? "agent-a",
    folderPath: overrides.folderPath ?? "C:/repo",
    source: overrides.source ?? "user",
    inheritedFromWorkflowId: overrides.inheritedFromWorkflowId ?? null,
    inheritedFromAgentId: overrides.inheritedFromAgentId ?? null,
  });

  const evaluateCondition = (condition: any, row: any): boolean => {
    if (!condition) return true;
    switch (condition.kind) {
      case "eq": {
        return row[condition.column.name] === condition.value;
      }
      case "ne":
        return row[condition.column.name] !== condition.value;
      case "isNull":
        return row[condition.column.name] == null;
      case "inArray":
        return condition.values.includes(row[condition.column.name]);
      case "and":
        return condition.conditions.every((child: any) =>
          evaluateCondition(child, row),
        );
      default:
        throw new Error(`Unhandled condition kind: ${condition.kind}`);
    }
  };

  const tableToState: Record<string, () => any[]> = {
    folders: () => state.folders,
    workflowMembers: () => state.workflowMembers,
    agentPlugins: () => state.pluginAssignments,
    plugins: () => state.plugins,
  };

  const rowsFor = (table: any): any[] => {
    if (table && typeof table.__table === "string" && tableToState[table.__table]) {
      return tableToState[table.__table]();
    }
    return [];
  };

  return { state, resetState, makeFolder, evaluateCondition, rowsFor };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: any[]) => ({ kind: "and", conditions }),
  eq: (column: any, value: any) => ({ kind: "eq", column, value }),
  ne: (column: any, value: any) => ({ kind: "ne", column, value }),
  inArray: (column: any, values: any[]) => ({ kind: "inArray", column, values }),
  isNull: (column: any) => ({ kind: "isNull", column }),
  desc: (column: any) => ({ kind: "desc", column }),
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
  },
  characters: {
    __table: "characters",
    id: { name: "id" },
    userId: { name: "userId" },
  },
}));

vi.mock("@/lib/db/sqlite-workflows-schema", () => ({
  agentWorkflows: {
    __table: "workflows",
    id: { name: "id" },
    userId: { name: "userId" },
    status: { name: "status" },
    updatedAt: { name: "updatedAt" },
  },
  agentWorkflowMembers: {
    __table: "workflowMembers",
    workflowId: { name: "workflowId" },
    agentId: { name: "agentId" },
    role: { name: "role" },
    createdAt: { name: "createdAt" },
  },
}));

vi.mock("@/lib/db/sqlite-plugins-schema", () => ({
  agentPlugins: {
    __table: "agentPlugins",
    agentId: { name: "agentId" },
    pluginId: { name: "pluginId" },
    enabled: { name: "enabled" },
  },
  plugins: {
    __table: "plugins",
    id: { name: "id" },
    components: { name: "components" },
  },
}));

vi.mock("@/lib/db/sqlite-client", () => ({
  db: {
    select(selection?: any) {
      return {
        from(table?: any) {
          const getRows = () => mocks.rowsFor(table);
          return {
            where(condition: any) {
              const filtered = getRows().filter((row) =>
                mocks.evaluateCondition(condition, row),
              );
              const projected = filtered.map((row) => {
                if (!selection) return row;
                const out: Record<string, unknown> = {};
                for (const [key, col] of Object.entries(selection)) {
                  out[key] = row[(col as any).name];
                }
                return out;
              });
              return Promise.resolve(projected);
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  },
}));

import { buildSharedResourcesSnapshot } from "@/lib/agents/workflow-db-helpers";

describe("buildSharedResourcesSnapshot", () => {
  beforeEach(() => {
    mocks.resetState();
  });

  it("excludes workspace-sourced folders from workflow-scoped snapshot", async () => {
    mocks.state.workflowMembers.push(
      { workflowId: "wf-1", agentId: "agent-a", role: "initiator" },
      { workflowId: "wf-1", agentId: "agent-b", role: "subagent" },
    );
    mocks.state.folders.push(
      mocks.makeFolder({ id: "user-folder-a", characterId: "agent-a", source: "user" }),
      mocks.makeFolder({
        id: "workspace-folder-a",
        characterId: "agent-a",
        folderPath: "/tmp/worktrees/feat-x",
        source: "workspace",
      }),
      mocks.makeFolder({ id: "user-folder-b", characterId: "agent-b", source: "user" }),
      mocks.makeFolder({
        id: "workspace-folder-b",
        characterId: "agent-b",
        folderPath: "/tmp/worktrees/feat-y",
        source: "workspace",
      }),
    );

    const snapshot = await buildSharedResourcesSnapshot({
      initiatorId: "agent-a",
      workflowId: "wf-1",
    });

    expect(snapshot.syncFolderIds.sort()).toEqual(["user-folder-a", "user-folder-b"]);
    expect(snapshot.syncFolderIds).not.toContain("workspace-folder-a");
    expect(snapshot.syncFolderIds).not.toContain("workspace-folder-b");
  });

  it("excludes workspace-sourced folders from initiator-only snapshot", async () => {
    mocks.state.folders.push(
      mocks.makeFolder({ id: "user-folder", characterId: "agent-a", source: "user" }),
      mocks.makeFolder({
        id: "workspace-folder",
        characterId: "agent-a",
        folderPath: "/tmp/worktrees/feat-x",
        source: "workspace",
      }),
    );

    const snapshot = await buildSharedResourcesSnapshot({
      initiatorId: "agent-a",
    });

    expect(snapshot.syncFolderIds).toEqual(["user-folder"]);
  });

  it("excludes inherited folders regardless of source", async () => {
    mocks.state.workflowMembers.push(
      { workflowId: "wf-1", agentId: "agent-b", role: "subagent" },
    );
    mocks.state.folders.push(
      mocks.makeFolder({
        id: "inherited-user",
        characterId: "agent-b",
        source: "user",
        inheritedFromWorkflowId: "wf-1",
      }),
    );

    const snapshot = await buildSharedResourcesSnapshot({
      initiatorId: "agent-a",
      workflowId: "wf-1",
    });

    expect(snapshot.syncFolderIds).toEqual([]);
  });
});
