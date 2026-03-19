import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => "external-user"),
}));

const dbMocks = vi.hoisted(() => ({
  getOrCreateLocalUser: vi.fn(async () => ({ id: "user-123" })),
  getSessionByCharacterId: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
}));

const characterMocks = vi.hoisted(() => ({
  getCharacter: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(() => ({ localUserEmail: "local@example.com" })),
}));

vi.mock("@/lib/auth/local-auth", () => authMocks);
vi.mock("@/lib/db/queries", () => dbMocks);
vi.mock("@/lib/characters/queries", () => characterMocks);
vi.mock("@/lib/settings/settings-manager", () => settingsMocks);

import { POST } from "@/app/api/overlay/resolve-session/route";

describe("POST /api/overlay/resolve-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    characterMocks.getCharacter.mockResolvedValue({
      id: "char-1",
      name: "Selene",
      userId: "user-123",
    });
    dbMocks.getSession.mockResolvedValue(null);
    dbMocks.getSessionByCharacterId.mockResolvedValue(null);
    dbMocks.createSession.mockResolvedValue({
      id: "new-session",
      title: "Chat with Selene",
    });
  });

  it("reuses the requested session when it belongs to the user and character", async () => {
    dbMocks.getSession.mockResolvedValue({
      id: "session-explicit",
      userId: "user-123",
      status: "active",
      characterId: "char-1",
      title: "Existing session",
    });

    const req = new Request("http://localhost/api/overlay/resolve-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "char-1", sessionId: "session-explicit" }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(dbMocks.getSession).toHaveBeenCalledWith("session-explicit");
    expect(dbMocks.getSessionByCharacterId).not.toHaveBeenCalled();
    expect(dbMocks.createSession).not.toHaveBeenCalled();
    expect(json).toMatchObject({
      sessionId: "session-explicit",
      isNew: false,
      title: "Existing session",
    });
  });

  it("reuses the latest character session regardless of age when forceNew is not set", async () => {
    dbMocks.getSessionByCharacterId.mockResolvedValue({
      id: "old-session",
      userId: "user-123",
      status: "active",
      characterId: "char-1",
      title: "Very old session",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    const req = new Request("http://localhost/api/overlay/resolve-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "char-1" }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(dbMocks.getSessionByCharacterId).toHaveBeenCalledWith("user-123", "char-1");
    expect(dbMocks.createSession).not.toHaveBeenCalled();
    expect(json).toMatchObject({
      sessionId: "old-session",
      isNew: false,
      title: "Very old session",
    });
  });

  it("creates a new session only when forceNew is explicitly requested", async () => {
    dbMocks.getSessionByCharacterId.mockResolvedValue({
      id: "existing-session",
      userId: "user-123",
      status: "active",
      characterId: "char-1",
      title: "Existing session",
    });

    const req = new Request("http://localhost/api/overlay/resolve-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "char-1", forceNew: true }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(dbMocks.getSessionByCharacterId).not.toHaveBeenCalled();
    expect(dbMocks.createSession).toHaveBeenCalledWith({
      title: "Chat with Selene",
      userId: "user-123",
      metadata: { characterId: "char-1", characterName: "Selene" },
    });
    expect(json).toMatchObject({
      sessionId: "new-session",
      isNew: true,
      title: "Chat with Selene",
    });
  });
});
