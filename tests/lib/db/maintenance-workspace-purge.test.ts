import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks for the cleanup module — runSessionMaintenance fires it
// asynchronously via `void cleanupPurgedWorkspaces(...)`.
// ---------------------------------------------------------------------------

const cleanupMocks = vi.hoisted(() => ({
  cleanupWorkspace: vi.fn(),
}));

vi.mock("@/lib/workspace/cleanup", () => ({
  cleanupWorkspace: cleanupMocks.cleanupWorkspace,
}));

import { runSessionMaintenance } from "@/lib/db/maintenance";

// ---------------------------------------------------------------------------
// Fake better-sqlite3 Database — implements only the methods maintenance uses.
// ---------------------------------------------------------------------------

interface FakeRunResult {
  changes: number;
}

type PreparedResult<T> = {
  all: (...bindParams: unknown[]) => T[];
  run: (...bindParams: unknown[]) => FakeRunResult;
};

type StatementHandler = (
  sql: string,
) => PreparedResult<{ sessionId: string; metadata: string }>;

/**
 * Build a fake sqlite DB: `prepare(sql).all(...)` / `.run(...)` are routed
 * by inspecting the SQL text so each test can stage its own row set.
 */
function makeFakeSqlite(handler: StatementHandler) {
  const db = {
    prepare: (sql: string) => handler(sql),
  };
  return db as unknown as import("better-sqlite3").Database;
}

describe("runSessionMaintenance — workspace purge integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanupMocks.cleanupWorkspace.mockResolvedValue({
      syncFolderRemoved: true,
      worktreeRemoved: true,
      errors: [],
    });
  });

  it("collects + fires cleanup for purged sessions with workspaceInfo", async () => {
    const rows = [
      {
        sessionId: "sess-old-1",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "worktree",
            status: "active",
            worktreePath: "/repo/wt/old-1",
            syncFolderId: "sf-1",
          },
        }),
      },
      {
        sessionId: "sess-old-2",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "worktree",
            status: "active",
            worktreePath: "/repo/wt/old-2",
            syncFolderId: "sf-2",
          },
        }),
      },
    ];

    const sqlite = makeFakeSqlite((sql: string) => {
      if (sql.includes("SELECT id AS sessionId")) {
        return { all: () => rows, run: () => ({ changes: 0 }) };
      }
      // DELETE / UPDATE / recompute UPDATE all return changes=2 for tidy logs.
      return { all: () => [], run: () => ({ changes: 2 }) };
    });

    runSessionMaintenance(sqlite);

    // Fire-and-forget — await a tick so the async cleanup can run.
    await vi.waitFor(() => {
      expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(2);
    });

    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "sf-1",
      worktreePath: "/repo/wt/old-1",
      trigger: "session-purge",
    });
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "sf-2",
      worktreePath: "/repo/wt/old-2",
      trigger: "session-purge",
    });
  });

  it("skips 'local' workspace types (user's real repo, not a worktree)", async () => {
    const rows = [
      {
        sessionId: "sess-local",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "local",
            status: "active",
            worktreePath: "/home/user/my-repo",
          },
        }),
      },
      {
        sessionId: "sess-worktree",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "worktree",
            status: "active",
            worktreePath: "/repo/wt/a",
            syncFolderId: "sf-a",
          },
        }),
      },
    ];

    const sqlite = makeFakeSqlite((sql: string) => {
      if (sql.includes("SELECT id AS sessionId")) {
        return { all: () => rows, run: () => ({ changes: 0 }) };
      }
      return { all: () => [], run: () => ({ changes: 2 }) };
    });

    runSessionMaintenance(sqlite);

    await vi.waitFor(() => {
      expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "sf-a",
      worktreePath: "/repo/wt/a",
      trigger: "session-purge",
    });
  });

  it("skips malformed JSON metadata without aborting the batch", async () => {
    const rows = [
      { sessionId: "broken", metadata: "{ not valid json" },
      {
        sessionId: "good",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "worktree",
            status: "active",
            worktreePath: "/repo/wt/ok",
            syncFolderId: "sf-ok",
          },
        }),
      },
    ];

    const sqlite = makeFakeSqlite((sql: string) => {
      if (sql.includes("SELECT id AS sessionId")) {
        return { all: () => rows, run: () => ({ changes: 0 }) };
      }
      return { all: () => [], run: () => ({ changes: 2 }) };
    });

    runSessionMaintenance(sqlite);

    await vi.waitFor(() => {
      expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "sf-ok",
      worktreePath: "/repo/wt/ok",
      trigger: "session-purge",
    });
  });

  it("continues the batch when cleanupWorkspace rejects for one row", async () => {
    const rows = [
      {
        sessionId: "a",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "worktree",
            status: "active",
            worktreePath: "/repo/wt/a",
            syncFolderId: "sf-a",
          },
        }),
      },
      {
        sessionId: "b",
        metadata: JSON.stringify({
          workspaceInfo: {
            type: "worktree",
            status: "active",
            worktreePath: "/repo/wt/b",
            syncFolderId: "sf-b",
          },
        }),
      },
    ];

    cleanupMocks.cleanupWorkspace
      .mockRejectedValueOnce(new Error("worktree locked"))
      .mockResolvedValueOnce({
        syncFolderRemoved: true,
        worktreeRemoved: true,
        errors: [],
      });

    const sqlite = makeFakeSqlite((sql: string) => {
      if (sql.includes("SELECT id AS sessionId")) {
        return { all: () => rows, run: () => ({ changes: 0 }) };
      }
      return { all: () => [], run: () => ({ changes: 2 }) };
    });

    runSessionMaintenance(sqlite);

    // Both rows attempted despite failure on the first.
    await vi.waitFor(() => {
      expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(2);
    });
  });

  it("does not call cleanupWorkspace when no workspaces are due for purge", async () => {
    const sqlite = makeFakeSqlite((sql: string) => {
      if (sql.includes("SELECT id AS sessionId")) {
        return { all: () => [], run: () => ({ changes: 0 }) };
      }
      return { all: () => [], run: () => ({ changes: 0 }) };
    });

    runSessionMaintenance(sqlite);

    // Give the microtask queue a chance to drain if anything WAS queued.
    await new Promise((r) => setTimeout(r, 20));
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
  });
});
