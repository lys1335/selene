import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getOrCreateLocalUser: vi.fn(),
  loadSettings: vi.fn(),
}));

const characterMocks = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
}));

const workflowMocks = vi.hoisted(() => ({
  detachAgentFromWorkflows: vi.fn(),
}));

const syncServiceMocks = vi.hoisted(() => ({
  getSyncFolders: vi.fn(),
}));

const fileWatcherMocks = vi.hoisted(() => ({
  stopWatching: vi.fn(),
}));

const cleanupMocks = vi.hoisted(() => ({
  cleanupWorkspace: vi.fn(),
}));

const collectionsMocks = vi.hoisted(() => ({
  deleteAgentTable: vi.fn(),
}));

vi.mock("@/lib/auth/local-auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

vi.mock("@/lib/db/queries", () => ({
  getOrCreateLocalUser: authMocks.getOrCreateLocalUser,
}));

vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: authMocks.loadSettings,
}));

vi.mock("@/lib/characters/queries", () => ({
  getCharacter: characterMocks.getCharacter,
  getCharacterFull: vi.fn(),
  getCharacterStats: vi.fn(),
  updateCharacter: vi.fn(),
  deleteCharacter: characterMocks.deleteCharacter,
}));

vi.mock("@/lib/agents/workflows", () => ({
  detachAgentFromWorkflows: workflowMocks.detachAgentFromWorkflows,
}));

// The route uses dynamic imports for these — vi.mock also intercepts those.
vi.mock("@/lib/vectordb/sync-service", () => ({
  getSyncFolders: syncServiceMocks.getSyncFolders,
}));

vi.mock("@/lib/vectordb/file-watcher", () => ({
  stopWatching: fileWatcherMocks.stopWatching,
}));

vi.mock("@/lib/workspace/cleanup", () => ({
  cleanupWorkspace: cleanupMocks.cleanupWorkspace,
}));

vi.mock("@/lib/vectordb/collections", () => ({
  deleteAgentTable: collectionsMocks.deleteAgentTable,
}));

import { DELETE } from "@/app/api/characters/[id]/route";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/characters/[id] — workspace folder cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    authMocks.requireAuth.mockResolvedValue("user-xyz");
    authMocks.loadSettings.mockReturnValue({ localUserEmail: "u@example.com" });
    authMocks.getOrCreateLocalUser.mockResolvedValue({ id: "db-user-1" });

    characterMocks.getCharacter.mockResolvedValue({
      id: "char-1",
      userId: "db-user-1",
    });
    characterMocks.deleteCharacter.mockResolvedValue(undefined);
    workflowMocks.detachAgentFromWorkflows.mockResolvedValue(undefined);
    fileWatcherMocks.stopWatching.mockResolvedValue(undefined);
    cleanupMocks.cleanupWorkspace.mockResolvedValue({
      syncFolderRemoved: true,
      worktreeRemoved: true,
      errors: [],
    });
    collectionsMocks.deleteAgentTable.mockResolvedValue(undefined);
  });

  it("cleans up workspace-sourced folders only (skips user-sourced folders)", async () => {
    syncServiceMocks.getSyncFolders.mockResolvedValue([
      { id: "f-user", folderPath: "/user/docs", source: "user" },
      { id: "f-wt-1", folderPath: "/repo/worktrees/a", source: "workspace" },
      { id: "f-wt-2", folderPath: "/repo/worktrees/b", source: "workspace" },
    ]);

    const req = new Request("http://localhost/api/characters/char-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("char-1"));
    expect(res.status).toBe(200);

    // stopWatching is called for ALL folders regardless of source.
    expect(fileWatcherMocks.stopWatching).toHaveBeenCalledTimes(3);

    // cleanupWorkspace is called ONLY for source === "workspace" folders.
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(2);
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "f-wt-1",
      worktreePath: "/repo/worktrees/a",
      trigger: "character-delete",
    });
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "f-wt-2",
      worktreePath: "/repo/worktrees/b",
      trigger: "character-delete",
    });

    // Character is deleted AFTER cleanup.
    expect(characterMocks.deleteCharacter).toHaveBeenCalledWith("char-1");
  });

  it("does not call cleanupWorkspace when there are no workspace-sourced folders", async () => {
    syncServiceMocks.getSyncFolders.mockResolvedValue([
      { id: "f1", folderPath: "/docs", source: "user" },
    ]);

    const req = new Request("http://localhost/api/characters/char-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("char-1"));
    expect(res.status).toBe(200);
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
    expect(characterMocks.deleteCharacter).toHaveBeenCalledWith("char-1");
  });

  it("continues deletion when cleanupWorkspace throws for one folder", async () => {
    syncServiceMocks.getSyncFolders.mockResolvedValue([
      { id: "f-wt-1", folderPath: "/wt/a", source: "workspace" },
      { id: "f-wt-2", folderPath: "/wt/b", source: "workspace" },
    ]);

    cleanupMocks.cleanupWorkspace
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        syncFolderRemoved: true,
        worktreeRemoved: true,
        errors: [],
      });

    const req = new Request("http://localhost/api/characters/char-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("char-1"));
    expect(res.status).toBe(200);
    // Both folders are attempted.
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(2);
    // Character is still deleted even after one cleanup failure.
    expect(characterMocks.deleteCharacter).toHaveBeenCalledWith("char-1");
  });

  it("rejects non-owner deletion with 403 and performs no cleanup", async () => {
    characterMocks.getCharacter.mockResolvedValue({
      id: "char-1",
      userId: "other-user",
    });

    const req = new Request("http://localhost/api/characters/char-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("char-1"));
    expect(res.status).toBe(403);
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
    expect(characterMocks.deleteCharacter).not.toHaveBeenCalled();
  });

  it("returns 404 when character does not exist", async () => {
    characterMocks.getCharacter.mockResolvedValue(null);

    const req = new Request("http://localhost/api/characters/ghost", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("ghost"));
    expect(res.status).toBe(404);
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
    expect(characterMocks.deleteCharacter).not.toHaveBeenCalled();
  });
});
