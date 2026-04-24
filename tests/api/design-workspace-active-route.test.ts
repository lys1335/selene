/**
 * Coverage for the Sprint 4 W4.3 persistence route:
 *   `GET  /api/design/workspace/active?sessionId=...`
 *   `POST /api/design/workspace/active`
 *
 * Mocks the query layer (already exercised by
 * `lib/design/workspace/__tests__/last-active-component-queries.test.ts`)
 * and asserts the route's envelope shape — keeping the two concerns
 * independent:
 *   - the route must forward reason codes from the setter to the
 *     response body (agent-actionable) with the correct status code;
 *   - the route must pass the authed userId to the setter / getter
 *     (not trust the client);
 *   - the GET response must include `lastActiveComponentId` in
 *     `data` even when the value is `null` (rehydration happy path
 *     with no saved pointer).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => "user-auth"),
}));

const lacMocks = vi.hoisted(() => ({
  getLastActiveComponentId: vi.fn(),
  setLastActiveComponentId: vi.fn(),
}));

vi.mock("@/lib/auth/local-auth", () => authMocks);
vi.mock("@/lib/design/workspace/last-active-component-queries", () => lacMocks);

import { GET, POST } from "@/app/api/design/workspace/active/route";

function makeRequest(
  url: string,
  init?: { method?: string; body?: unknown; cookie?: string },
): Request {
  const headers: Record<string, string> = {};
  if (init?.cookie) headers.cookie = init.cookie;
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

describe("GET /api/design/workspace/active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no pointer is set (rehydration happy path with empty session)", async () => {
    lacMocks.getLastActiveComponentId.mockResolvedValue(null);

    const response = await GET(
      makeRequest(
        "http://localhost/api/design/workspace/active?sessionId=sess-1",
      ) as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data?: { lastActiveComponentId: string | null };
    };
    expect(body.success).toBe(true);
    expect(body.data?.lastActiveComponentId).toBeNull();

    // userId is injected from `requireAuth`, never from client input.
    expect(lacMocks.getLastActiveComponentId).toHaveBeenCalledWith({
      userId: "user-auth",
      sessionId: "sess-1",
    });
  });

  it("returns the pointer when present (rehydration happy path)", async () => {
    lacMocks.getLastActiveComponentId.mockResolvedValue("comp-42");

    const response = await GET(
      makeRequest(
        "http://localhost/api/design/workspace/active?sessionId=sess-1",
      ) as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data?: { lastActiveComponentId: string | null };
    };
    expect(body.data?.lastActiveComponentId).toBe("comp-42");
  });

  it("rejects a missing sessionId with 400", async () => {
    const response = await GET(
      makeRequest(
        "http://localhost/api/design/workspace/active",
      ) as unknown as Parameters<typeof GET>[0],
    );
    expect(response.status).toBe(400);
    expect(lacMocks.getLastActiveComponentId).not.toHaveBeenCalled();
  });
});

describe("POST /api/design/workspace/active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists a live pointer and echoes it back", async () => {
    lacMocks.setLastActiveComponentId.mockResolvedValue({
      ok: true,
      lastActiveComponentId: "comp-1",
    });

    const response = await POST(
      makeRequest("http://localhost/api/design/workspace/active", {
        method: "POST",
        body: { sessionId: "sess-1", componentId: "comp-1" },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data?: { lastActiveComponentId: string | null };
    };
    expect(body.success).toBe(true);
    expect(body.data?.lastActiveComponentId).toBe("comp-1");

    expect(lacMocks.setLastActiveComponentId).toHaveBeenCalledWith({
      userId: "user-auth",
      sessionId: "sess-1",
      componentId: "comp-1",
    });
  });

  it("allows clearing the pointer with componentId: null", async () => {
    lacMocks.setLastActiveComponentId.mockResolvedValue({
      ok: true,
      lastActiveComponentId: null,
    });

    const response = await POST(
      makeRequest("http://localhost/api/design/workspace/active", {
        method: "POST",
        body: { sessionId: "sess-1", componentId: null },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data?: { lastActiveComponentId: string | null };
    };
    expect(body.data?.lastActiveComponentId).toBeNull();
  });

  it("forwards COMPONENT_SCOPE_MISMATCH with an agent-actionable reason", async () => {
    lacMocks.setLastActiveComponentId.mockResolvedValue({
      ok: false,
      reason: "COMPONENT_SCOPE_MISMATCH",
      message: "Component comp-1 is not owned by session sess-2.",
    });

    const response = await POST(
      makeRequest("http://localhost/api/design/workspace/active", {
        method: "POST",
        body: { sessionId: "sess-2", componentId: "comp-1" },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(404); // scope mismatch → 404 (no existence leak)
    const body = (await response.json()) as {
      success: boolean;
      reason?: string;
      error?: string;
    };
    expect(body.success).toBe(false);
    // Agent-actionable structured reason, not a stripped message.
    expect(body.reason).toBe("COMPONENT_SCOPE_MISMATCH");
    expect(typeof body.error).toBe("string");
  });

  it("rejects an invalid componentId shape with 400 and does not call the setter", async () => {
    const response = await POST(
      makeRequest("http://localhost/api/design/workspace/active", {
        method: "POST",
        body: { sessionId: "sess-1", componentId: 123 },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(400);
    expect(lacMocks.setLastActiveComponentId).not.toHaveBeenCalled();
  });

  it("returns 401 when requireAuth rejects", async () => {
    authMocks.requireAuth.mockRejectedValueOnce(new Error("Unauthorized"));

    const response = await POST(
      makeRequest("http://localhost/api/design/workspace/active", {
        method: "POST",
        body: { sessionId: "sess-1", componentId: null },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(401);
    expect(lacMocks.setLastActiveComponentId).not.toHaveBeenCalled();
  });
});
