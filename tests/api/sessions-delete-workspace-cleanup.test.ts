import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mocks for lifecycle under test
// ---------------------------------------------------------------------------

const dbMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  getSessionWithMessages: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  resolveSessionAuth: vi.fn(),
}));

const cleanupMocks = vi.hoisted(() => ({
  cleanupWorkspace: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getSession: dbMocks.getSession,
  updateSession: dbMocks.updateSession,
  getSessionWithMessages: dbMocks.getSessionWithMessages,
}));

vi.mock("@/lib/api/shared-handlers", () => ({
  resolveSessionAuth: authMocks.resolveSessionAuth,
}));

vi.mock("@/lib/workspace/cleanup", () => ({
  cleanupWorkspace: cleanupMocks.cleanupWorkspace,
}));

import { DELETE } from "@/app/api/sessions/[id]/route";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/sessions/[id] — workspace cleanup on session soft-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Default: auth passes and returns a fake session shell.
    authMocks.resolveSessionAuth.mockResolvedValue({
      session: { id: "sess-1", userId: "user-1" },
      dbUserId: "user-1",
    });
    dbMocks.updateSession.mockResolvedValue(undefined);
    cleanupMocks.cleanupWorkspace.mockResolvedValue({
      syncFolderRemoved: true,
      worktreeRemoved: true,
      errors: [],
    });
  });

  it("invokes cleanupWorkspace for worktree-type sessions before soft-deleting", async () => {
    dbMocks.getSession.mockResolvedValue({
      id: "sess-1",
      metadata: {
        workspaceInfo: {
          type: "worktree",
          status: "active",
          worktreePath: "/repo/worktrees/f1",
          syncFolderId: "folder-abc",
        },
      },
    });

    const req = new NextRequest("http://localhost/api/sessions/sess-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("sess-1"));
    expect(res.status).toBe(200);

    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledTimes(1);
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalledWith({
      syncFolderId: "folder-abc",
      worktreePath: "/repo/worktrees/f1",
      trigger: "session-delete",
    });

    // Session status is still flipped to 'deleted' after cleanup.
    expect(dbMocks.updateSession).toHaveBeenCalledWith("sess-1", {
      status: "deleted",
    });
  });

  it("skips cleanup for 'local' workspace type (user's real repo, not a worktree)", async () => {
    dbMocks.getSession.mockResolvedValue({
      id: "sess-1",
      metadata: {
        workspaceInfo: {
          type: "local",
          status: "active",
          worktreePath: "/home/user/my-repo",
        },
      },
    });

    const req = new NextRequest("http://localhost/api/sessions/sess-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("sess-1"));
    expect(res.status).toBe(200);
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
    expect(dbMocks.updateSession).toHaveBeenCalledWith("sess-1", {
      status: "deleted",
    });
  });

  it("skips cleanup when session has no workspace metadata", async () => {
    dbMocks.getSession.mockResolvedValue({
      id: "sess-1",
      metadata: {},
    });

    const req = new NextRequest("http://localhost/api/sessions/sess-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("sess-1"));
    expect(res.status).toBe(200);
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
  });

  it("still soft-deletes the session when cleanupWorkspace throws", async () => {
    dbMocks.getSession.mockResolvedValue({
      id: "sess-1",
      metadata: {
        workspaceInfo: {
          type: "worktree",
          status: "active",
          worktreePath: "/repo/wt",
          syncFolderId: "folder-1",
        },
      },
    });
    cleanupMocks.cleanupWorkspace.mockRejectedValueOnce(new Error("git failed"));

    const req = new NextRequest("http://localhost/api/sessions/sess-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("sess-1"));
    expect(res.status).toBe(200);
    expect(cleanupMocks.cleanupWorkspace).toHaveBeenCalled();
    // Critical invariant: session deletion is NEVER blocked by cleanup errors.
    expect(dbMocks.updateSession).toHaveBeenCalledWith("sess-1", {
      status: "deleted",
    });
  });

  it("returns the auth error response when authorization fails", async () => {
    authMocks.resolveSessionAuth.mockResolvedValueOnce({
      errorResponse: new Response("forbidden", { status: 403 }),
    });

    const req = new NextRequest("http://localhost/api/sessions/sess-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, makeParams("sess-1"));
    expect(res.status).toBe(403);
    expect(dbMocks.getSession).not.toHaveBeenCalled();
    expect(cleanupMocks.cleanupWorkspace).not.toHaveBeenCalled();
    expect(dbMocks.updateSession).not.toHaveBeenCalled();
  });
});
