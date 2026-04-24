import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — wire BEFORE importing the SUT so module bindings are captured
// ---------------------------------------------------------------------------

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  realpathSync: vi.fn(),
}));

const gitRunnerMocks = vi.hoisted(() => ({
  runGitCommand: vi.fn(),
}));

const syncServiceMocks = vi.hoisted(() => ({
  removeSyncFolder: vi.fn(),
}));

const metricsMocks = vi.hoisted(() => ({
  recordWorkspaceDelete: vi.fn(),
  recordWorkspaceCleanup: vi.fn(),
  recordWorkspaceCleanupError: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: fsMocks.existsSync,
  realpathSync: fsMocks.realpathSync,
}));

vi.mock("@/lib/workspace/git-runner", () => ({
  runGitCommand: gitRunnerMocks.runGitCommand,
}));

vi.mock("@/lib/vectordb/sync-service", () => ({
  removeSyncFolder: syncServiceMocks.removeSyncFolder,
}));

vi.mock("@/lib/workspace/metrics", () => ({
  recordWorkspaceDelete: metricsMocks.recordWorkspaceDelete,
  recordWorkspaceCleanup: metricsMocks.recordWorkspaceCleanup,
  recordWorkspaceCleanupError: metricsMocks.recordWorkspaceCleanupError,
}));

// Silence console.error — failure paths log diagnostic info that drowns the
// test runner output.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

import { cleanupWorkspace } from "@/lib/workspace/cleanup";

describe("cleanupWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.realpathSync.mockImplementation((p: string) => p);
    // Default: `rev-parse --git-common-dir` returns `<repo>/.git`
    gitRunnerMocks.runGitCommand.mockImplementation(
      async (_cwd: string, args: string[]) => {
        if (args[0] === "rev-parse") return "/repo/.git\n";
        return "";
      },
    );
    syncServiceMocks.removeSyncFolder.mockResolvedValue(undefined);
  });

  it("removes both sync folder row and git worktree on happy path", async () => {
    const result = await cleanupWorkspace({
      worktreePath: "/repo/worktrees/feature-x",
      syncFolderId: "folder-123",
      trigger: "workspace-tool-delete",
    });

    expect(result.syncFolderRemoved).toBe(true);
    expect(result.worktreeRemoved).toBe(true);
    expect(result.errors).toEqual([]);

    expect(syncServiceMocks.removeSyncFolder).toHaveBeenCalledWith("folder-123");
    // rev-parse --git-common-dir (lookup), then worktree remove --force
    expect(gitRunnerMocks.runGitCommand).toHaveBeenCalledWith(
      "/repo/worktrees/feature-x",
      ["rev-parse", "--git-common-dir"],
    );
    expect(gitRunnerMocks.runGitCommand).toHaveBeenCalledWith(
      "/repo",
      ["worktree", "remove", "/repo/worktrees/feature-x", "--force"],
    );
  });

  it("records recordWorkspaceDelete when trigger is workspace-tool-delete", async () => {
    await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "workspace-tool-delete",
    });
    expect(metricsMocks.recordWorkspaceDelete).toHaveBeenCalledTimes(1);
    expect(metricsMocks.recordWorkspaceCleanup).not.toHaveBeenCalled();
  });

  it("records recordWorkspaceCleanup('session-delete') for session trigger", async () => {
    await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "session-delete",
    });
    expect(metricsMocks.recordWorkspaceCleanup).toHaveBeenCalledWith("session-delete");
    expect(metricsMocks.recordWorkspaceDelete).not.toHaveBeenCalled();
  });

  it("records recordWorkspaceCleanup('session-purge') for maintenance trigger", async () => {
    await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "session-purge",
    });
    expect(metricsMocks.recordWorkspaceCleanup).toHaveBeenCalledWith("session-purge");
  });

  it("records recordWorkspaceCleanup('character-delete') for character trigger", async () => {
    await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "character-delete",
    });
    expect(metricsMocks.recordWorkspaceCleanup).toHaveBeenCalledWith("character-delete");
  });

  it("continues to worktree cleanup even when removeSyncFolder fails", async () => {
    syncServiceMocks.removeSyncFolder.mockRejectedValueOnce(new Error("db locked"));

    const result = await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "session-delete",
    });

    expect(result.syncFolderRemoved).toBe(false);
    expect(result.worktreeRemoved).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("removeSyncFolder failed");
    expect(result.errors[0]).toContain("db locked");
    expect(metricsMocks.recordWorkspaceCleanupError).toHaveBeenCalledTimes(1);
    // Trigger metric still recorded
    expect(metricsMocks.recordWorkspaceCleanup).toHaveBeenCalledWith("session-delete");
  });

  it("collects worktree-remove failure without throwing", async () => {
    gitRunnerMocks.runGitCommand.mockImplementation(async (_cwd, args) => {
      if (args[0] === "rev-parse") return "/repo/.git\n";
      if (args[0] === "worktree") throw new Error("worktree locked");
      return "";
    });

    const result = await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "workspace-tool-delete",
    });

    expect(result.syncFolderRemoved).toBe(true);
    expect(result.worktreeRemoved).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("git worktree remove failed");
    expect(metricsMocks.recordWorkspaceCleanupError).toHaveBeenCalledTimes(1);
  });

  it("skips worktree cleanup when directory does not exist on disk", async () => {
    fsMocks.existsSync.mockReturnValue(false);

    const result = await cleanupWorkspace({
      worktreePath: "/repo/wt",
      syncFolderId: "f1",
      trigger: "session-purge",
    });

    expect(result.syncFolderRemoved).toBe(true);
    expect(result.worktreeRemoved).toBe(false);
    expect(result.errors).toEqual([]);
    // No git calls issued when path doesn't exist
    expect(gitRunnerMocks.runGitCommand).not.toHaveBeenCalled();
  });

  it("rejects shell-metacharacter paths as unsafe", async () => {
    const result = await cleanupWorkspace({
      worktreePath: "/repo/wt; rm -rf /",
      syncFolderId: "f1",
      trigger: "workspace-tool-delete",
    });

    // Sync folder still removed, but worktree path is ignored.
    expect(result.syncFolderRemoved).toBe(true);
    expect(result.worktreeRemoved).toBe(false);
    expect(gitRunnerMocks.runGitCommand).not.toHaveBeenCalled();
  });

  it("handles row-only cleanup when worktreePath missing", async () => {
    const result = await cleanupWorkspace({
      syncFolderId: "orphan-row",
      trigger: "session-delete",
    });

    expect(result.syncFolderRemoved).toBe(true);
    expect(result.worktreeRemoved).toBe(false);
    expect(syncServiceMocks.removeSyncFolder).toHaveBeenCalledWith("orphan-row");
    expect(gitRunnerMocks.runGitCommand).not.toHaveBeenCalled();
  });

  it("handles worktree-only cleanup when syncFolderId missing", async () => {
    const result = await cleanupWorkspace({
      worktreePath: "/repo/wt",
      trigger: "character-delete",
    });

    expect(result.syncFolderRemoved).toBe(false);
    expect(result.worktreeRemoved).toBe(true);
    expect(syncServiceMocks.removeSyncFolder).not.toHaveBeenCalled();
  });

  it("is a no-op returning false flags when both inputs are missing", async () => {
    const result = await cleanupWorkspace({ trigger: "session-purge" });

    expect(result.syncFolderRemoved).toBe(false);
    expect(result.worktreeRemoved).toBe(false);
    expect(result.errors).toEqual([]);
    // Metric still recorded — the caller asked for a cleanup attempt.
    expect(metricsMocks.recordWorkspaceCleanup).toHaveBeenCalledWith("session-purge");
  });

  it("resolves main repo via realpathSync on the common-dir output", async () => {
    // When rev-parse returns a common dir ending in /.git, cleanup.ts strips
    // the trailing .git before passing to realpathSync.
    gitRunnerMocks.runGitCommand.mockImplementation(async (_cwd, args) => {
      if (args[0] === "rev-parse") return "/my-repo/.git\n";
      return "";
    });
    fsMocks.realpathSync.mockImplementation((p: string) => p);

    await cleanupWorkspace({
      worktreePath: "/my-repo/worktrees/branch",
      syncFolderId: "f1",
      trigger: "workspace-tool-delete",
    });

    // realpathSync should have been asked to resolve "/my-repo" (after
    // stripping the /.git suffix).
    expect(fsMocks.realpathSync).toHaveBeenCalledWith("/my-repo");
  });
});
