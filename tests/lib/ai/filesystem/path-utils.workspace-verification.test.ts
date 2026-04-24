/**
 * Coverage for `getActiveWorktreePath` DB-backed verification (defense-in-depth).
 *
 * The function returns a worktree path only when BOTH:
 *   1. The session metadata (`workspaceInfo.worktreePath`) names a worktree path.
 *   2. An `agent_sync_folders` row with `source='workspace'` exists for the
 *      same character at the same path.
 *
 * These tests prove the cross-check rejects the two failure modes flagged in
 * code review:
 *   - Stale session metadata after orphan-cleanup removed the DB row.
 *   - A row exists for the path but with `source='user'` (i.e. someone tried
 *     to launder a user folder through session metadata).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = {
  // Each entry: { characterId, folderPath, source }
  syncFolderRows: [] as Array<{ characterId: string; folderPath: string; source: string }>,
  sessionRows: new Map<string, { id: string; characterId: string | null; metadata: any }>(),
};

// Mock drizzle so we can interpret the where clauses ourselves.
vi.mock("drizzle-orm", () => ({
  and: (...conditions: any[]) => ({ kind: "and", conditions }),
  eq: (column: any, value: any) => ({ kind: "eq", column: column.__name, value }),
  like: vi.fn(),
}));

vi.mock("@/lib/db/sqlite-character-schema", () => ({
  agentSyncFolders: {
    id: { __name: "id" },
    characterId: { __name: "characterId" },
    folderPath: { __name: "folderPath" },
    source: { __name: "source" },
  },
  agentSyncFiles: {
    characterId: { __name: "characterId" },
    relativePath: { __name: "relativePath" },
  },
}));

vi.mock("@/lib/db/sqlite-client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: any) => ({
          limit: (_n: number) => {
            // Walk the condition tree to extract the constraints we care about.
            const constraints: Record<string, string> = {};
            const collect = (c: any) => {
              if (!c) return;
              if (c.kind === "and") c.conditions.forEach(collect);
              if (c.kind === "eq") constraints[c.column] = c.value;
            };
            collect(condition);

            const matches = dbState.syncFolderRows.filter(
              (row) =>
                (constraints.characterId === undefined || row.characterId === constraints.characterId) &&
                (constraints.folderPath === undefined || row.folderPath === constraints.folderPath) &&
                (constraints.source === undefined || row.source === constraints.source),
            );
            return Promise.resolve(matches.map((r) => ({ id: "row-id" })));
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/queries-sessions", () => ({
  getSession: async (id: string) => dbState.sessionRows.get(id) ?? null,
}));

vi.mock("@/lib/workspace/types", () => ({
  getWorkspaceInfo: (metadata: any) => metadata?.workspaceInfo ?? null,
}));

vi.mock("@/lib/vectordb/accessible-sync-folders", () => ({
  getAccessibleSyncFolders: vi.fn(),
}));

import { getActiveWorktreePath } from "@/lib/ai/filesystem/path-utils";

const WORKTREE_PATH = "/Users/me/repo/.worktrees/feature-x";

describe("getActiveWorktreePath — DB-backed verification", () => {
  beforeEach(() => {
    dbState.syncFolderRows = [];
    dbState.sessionRows.clear();
  });

  it("returns the worktree path when session metadata + DB row both align", () => {
    dbState.sessionRows.set("sess-1", {
      id: "sess-1",
      characterId: "char-a",
      metadata: { workspaceInfo: { worktreePath: WORKTREE_PATH } },
    });
    dbState.syncFolderRows.push({
      characterId: "char-a",
      folderPath: WORKTREE_PATH,
      source: "workspace",
    });

    return expect(getActiveWorktreePath("sess-1")).resolves.toBe(WORKTREE_PATH);
  });

  it("returns null for UNSCOPED sessionId", () => {
    return expect(getActiveWorktreePath("UNSCOPED")).resolves.toBeNull();
  });

  it("returns null when sessionId is empty", () => {
    return expect(getActiveWorktreePath("")).resolves.toBeNull();
  });

  it("returns null when session does not exist", () => {
    return expect(getActiveWorktreePath("ghost-session")).resolves.toBeNull();
  });

  it("returns null when session has no workspaceInfo metadata", () => {
    dbState.sessionRows.set("sess-2", {
      id: "sess-2",
      characterId: "char-a",
      metadata: { otherStuff: "ignored" },
    });
    return expect(getActiveWorktreePath("sess-2")).resolves.toBeNull();
  });

  it("returns null when worktreePath is missing from workspaceInfo", () => {
    dbState.sessionRows.set("sess-3", {
      id: "sess-3",
      characterId: "char-a",
      metadata: { workspaceInfo: { branch: "feature/x" } },
    });
    return expect(getActiveWorktreePath("sess-3")).resolves.toBeNull();
  });

  it("rejects stale session metadata after orphan cleanup removed the DB row", async () => {
    // Session still says we're on a worktree, but the DB row was swept
    // by `cleanupOrphanedWorkspaceFolders` because the worktree disappeared
    // from disk. Without the cross-check, file tools would keep treating
    // the path as authorized — that's the leak we're closing.
    dbState.sessionRows.set("sess-orphan", {
      id: "sess-orphan",
      characterId: "char-a",
      metadata: { workspaceInfo: { worktreePath: WORKTREE_PATH } },
    });
    // No syncFolderRows entry → orphaned session metadata.
    expect(await getActiveWorktreePath("sess-orphan")).toBeNull();
  });

  it("rejects metadata pointing at a path that exists as a USER folder (not workspace)", async () => {
    // Defense in depth: if anyone ever sets workspaceInfo.worktreePath to a
    // path that has a sync row but with source='user' (i.e. trying to launder
    // a normal user folder through session metadata), we must NOT widen the
    // worktree-aware path resolution to it.
    dbState.sessionRows.set("sess-launder", {
      id: "sess-launder",
      characterId: "char-a",
      metadata: { workspaceInfo: { worktreePath: "/Users/me/secrets" } },
    });
    dbState.syncFolderRows.push({
      characterId: "char-a",
      folderPath: "/Users/me/secrets",
      source: "user", // ← not 'workspace'
    });

    expect(await getActiveWorktreePath("sess-launder")).toBeNull();
  });

  it("rejects when the sync row is for a DIFFERENT character", async () => {
    // A worktree row exists at this path, but it belongs to char-b — char-a
    // must not inherit char-b's workspace authorization just because
    // char-a's session metadata happens to name the same path.
    dbState.sessionRows.set("sess-cross", {
      id: "sess-cross",
      characterId: "char-a",
      metadata: { workspaceInfo: { worktreePath: WORKTREE_PATH } },
    });
    dbState.syncFolderRows.push({
      characterId: "char-b", // ← not char-a
      folderPath: WORKTREE_PATH,
      source: "workspace",
    });

    expect(await getActiveWorktreePath("sess-cross")).toBeNull();
  });

  it("returns null when the session has no characterId", async () => {
    dbState.sessionRows.set("sess-no-char", {
      id: "sess-no-char",
      characterId: null,
      metadata: { workspaceInfo: { worktreePath: WORKTREE_PATH } },
    });
    expect(await getActiveWorktreePath("sess-no-char")).toBeNull();
  });
});
