/**
 * Probe-level coverage for the Sprint 3 W3.2 `designWorkspace`
 * `snapshot.diff` action.
 *
 * Mocks `snapshot-queries` so the tool handler is driven against a
 * controllable `findSnapshotById` without touching SQLite. The actual
 * `createPortDiff` implementation is exercised through its real module
 * (no mock) so the integration between the handler and the diff util is
 * verified end-to-end — including the identical-content / truncation
 * branches.
 *
 * Invariants under test:
 *
 *   1. Two identical snapshots → `success: true`, `sameContent: true`,
 *      `diff: ""`, `totalLines: 0`. Agent can branch on `sameContent`.
 *   2. Two differing snapshots → `success: true`, `sameContent: false`,
 *      non-empty `diff`. Envelope carries compact `a` / `b` summaries
 *      (id, createdAt, name, isPinned, componentId — no `sourceCode`).
 *   3. maxLines default cap: when the untruncated diff exceeds the
 *      default (1000), the envelope carries `diffTruncated: true` and
 *      the `diff` string ends with the truncation marker.
 *   4. Missing `a` id (findSnapshotById returns null on the a-side) →
 *      `errorCode: "SNAPSHOT_NOT_FOUND"`, `missingId === a`.
 *   5. Missing `b` id (a resolves, b does not) →
 *      `errorCode: "SNAPSHOT_NOT_FOUND"`, `missingId === b`.
 *   6. Cross-session id (handler's scope is A but row is owned by
 *      session B — simulated by having findSnapshotById return null
 *      for the call) → `SNAPSHOT_NOT_FOUND`, no existence leak (no
 *      separate "forbidden" code, no cross-session details on the
 *      envelope).
 *   7. Cross-user id (same no-leak contract as cross-session).
 *   8. `maxLines > 5000` → `SNAPSHOT_DIFF_INVALID_INPUT`.
 *   9. `maxLines <= 0` → `SNAPSHOT_DIFF_INVALID_INPUT`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const snapshotMocks = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
  findSnapshotById: vi.fn(),
  listSnapshots: vi.fn(),
  pinSnapshot: vi.fn(),
  renameSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

const galleryMocks = vi.hoisted(() => ({
  findWorkspaceDesign: vi.fn(),
  listWorkspaceDesigns: vi.fn(),
  saveDesignComponentRecord: vi.fn(),
  findDesignComponentBySourcePath: vi.fn(),
  updateDesignComponent: vi.fn(),
  upsertImportedDesignComponent: vi.fn(),
}));

vi.mock("@/lib/design/gallery/snapshot-queries", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/design/gallery/snapshot-queries")
  >("@/lib/design/gallery/snapshot-queries");
  return {
    ...actual,
    createSnapshot: snapshotMocks.createSnapshot,
    findSnapshotById: snapshotMocks.findSnapshotById,
    listSnapshots: snapshotMocks.listSnapshots,
    pinSnapshot: snapshotMocks.pinSnapshot,
    renameSnapshot: snapshotMocks.renameSnapshot,
    deleteSnapshot: snapshotMocks.deleteSnapshot,
  };
});

vi.mock("@/lib/design/gallery/queries", () => ({
  findDesignComponentBySourcePath: galleryMocks.findDesignComponentBySourcePath,
  updateDesignComponent: galleryMocks.updateDesignComponent,
  upsertImportedDesignComponent: galleryMocks.upsertImportedDesignComponent,
}));

vi.mock("@/lib/design/gallery/service", () => ({
  findWorkspaceDesign: galleryMocks.findWorkspaceDesign,
  listWorkspaceDesigns: galleryMocks.listWorkspaceDesigns,
  saveDesignComponentRecord: galleryMocks.saveDesignComponentRecord,
}));

vi.mock("@/lib/ai/tool-registry/logging", () => ({
  withToolLogging: (
    _name: string,
    _sessionId: string | undefined,
    fn: (input: unknown) => Promise<unknown>,
  ) => fn,
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { createDesignWorkspaceTool } from "@/lib/ai/tools/design-workspace-tool";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const SESSION_ID = "sess-1";
const CHARACTER_ID = "char-1";
const COMPONENT_ID = "component-1";

function makeSnapshotRow(overrides: Record<string, unknown> = {}) {
  const base = {
    id: "snap-default",
    userId: USER_ID,
    sessionId: SESSION_ID,
    componentId: COMPONENT_ID,
    sourceCode: "const A = 1;",
    name: null as string | null,
    isPinned: false,
    metadata: null,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

async function runTool(
  input: Record<string, unknown>,
  toolOptions: {
    sessionId?: string;
    userId?: string;
    characterId?: string;
  } = { sessionId: SESSION_ID, userId: USER_ID, characterId: CHARACTER_ID },
) {
  const tool = createDesignWorkspaceTool(toolOptions);
  const result = await (
    tool as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    }
  ).execute(input);
  return result as {
    success: boolean;
    action: string;
    error?: string;
    data?: Record<string, unknown>;
  };
}

/**
 * Build a `findSnapshotById` mock that returns specific rows for specific
 * ids. Unknown ids resolve to `null` — which exercises the scope-isolation
 * contract the real query module enforces (cross-user / cross-session
 * mismatches also return `null`).
 */
function mockFindByIdMap(
  rows: Record<string, ReturnType<typeof makeSnapshotRow> | null>,
) {
  snapshotMocks.findSnapshotById.mockImplementation(
    async (
      id: string,
      _userId: string,
      _sessionId: string,
    ): Promise<ReturnType<typeof makeSnapshotRow> | null> => {
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path: identical snapshots
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.diff (identical content)", () => {
  it("returns sameContent:true and an empty diff when both rows carry identical sourceCode", async () => {
    const src = "export const SAME = 1;\n";
    mockFindByIdMap({
      "snap-a": makeSnapshotRow({ id: "snap-a", sourceCode: src, name: "v1" }),
      "snap-b": makeSnapshotRow({ id: "snap-b", sourceCode: src, name: "v2" }),
    });

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("snapshot.diff");
    expect(result.data?.sameContent).toBe(true);
    expect(result.data?.diff).toBe("");
    expect(result.data?.diffTruncated).toBe(false);
    expect(result.data?.totalLines).toBe(0);
    // `a` / `b` summaries travel with both success AND failure envelopes —
    // but they must never carry `sourceCode` (the diff itself is the only
    // content channel).
    const a = result.data?.a as Record<string, unknown>;
    const b = result.data?.b as Record<string, unknown>;
    expect(a.id).toBe("snap-a");
    expect(b.id).toBe("snap-b");
    expect(a.name).toBe("v1");
    expect(b.name).toBe("v2");
    expect(a.componentId).toBe(COMPONENT_ID);
    expect(a.isPinned).toBe(false);
    expect("sourceCode" in a).toBe(false);
    expect("sourceCode" in b).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Happy path: different snapshots
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.diff (differing content)", () => {
  it("returns sameContent:false and a non-empty unified diff when sourceCode differs", async () => {
    mockFindByIdMap({
      "snap-a": makeSnapshotRow({
        id: "snap-a",
        sourceCode: "const A = 1;\nconst B = 2;\n",
      }),
      "snap-b": makeSnapshotRow({
        id: "snap-b",
        sourceCode: "const A = 1;\nconst B = 99;\n",
      }),
    });

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
    });

    expect(result.success).toBe(true);
    expect(result.data?.sameContent).toBe(false);
    const diff = result.data?.diff as string;
    expect(typeof diff).toBe("string");
    expect(diff.length).toBeGreaterThan(0);
    // Unified diff signatures — present regardless of the context count.
    expect(diff).toMatch(/^---\s/m);
    expect(diff).toMatch(/^\+\+\+\s/m);
    // The changed line appears on both sides.
    expect(diff).toMatch(/-const B = 2;/);
    expect(diff).toMatch(/\+const B = 99;/);
    expect(typeof result.data?.totalLines).toBe("number");
    expect((result.data?.totalLines as number) > 0).toBe(true);
    expect(result.data?.diffTruncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// maxLines default cap (1000) — overflow surfaces truncated:true
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.diff maxLines default cap", () => {
  it("truncates to the default 1000 lines when the untruncated diff overflows", async () => {
    // Produce >1000 lines of divergence so the default cap engages.
    // Each line is distinct so every row becomes a diff hunk line.
    const beforeLines = Array.from({ length: 1200 }, (_, i) => `line-before-${i}`).join("\n");
    const afterLines = Array.from({ length: 1200 }, (_, i) => `line-after-${i}`).join("\n");
    mockFindByIdMap({
      "snap-a": makeSnapshotRow({ id: "snap-a", sourceCode: beforeLines }),
      "snap-b": makeSnapshotRow({ id: "snap-b", sourceCode: afterLines }),
    });

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
      // NB: no maxLines — exercise the default (1000).
    });

    expect(result.success).toBe(true);
    expect(result.data?.sameContent).toBe(false);
    expect(result.data?.diffTruncated).toBe(true);
    const diff = result.data?.diff as string;
    // createPortDiff appends a "... [diff truncated: N more line(s)]" marker.
    expect(diff).toMatch(/\[diff truncated:/);
    // totalLines is the UNTRUNCATED line count — strictly greater than 1000
    // because the default cap fired.
    expect((result.data?.totalLines as number) > 1000).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SNAPSHOT_NOT_FOUND branches — no existence leak
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.diff scope isolation", () => {
  it("emits SNAPSHOT_NOT_FOUND with missingId === a when the a-side id is not in scope", async () => {
    mockFindByIdMap({
      // Only snap-b resolves in-scope.
      "snap-b": makeSnapshotRow({ id: "snap-b" }),
    });

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
    expect(result.data?.missingId).toBe("snap-a");
    // No "belongingUserId" / "belongingSessionId" / forbidden code —
    // existence must not leak.
    expect(result.data?.errorCode).not.toBe("FORBIDDEN");
    expect(result.data).not.toHaveProperty("belongingUserId");
    expect(result.data).not.toHaveProperty("belongingSessionId");
  });

  it("emits SNAPSHOT_NOT_FOUND with missingId === b when only the b-side id is missing", async () => {
    mockFindByIdMap({
      "snap-a": makeSnapshotRow({ id: "snap-a" }),
      // snap-b intentionally absent.
    });

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
    expect(result.data?.missingId).toBe("snap-b");
  });

  it("treats a cross-session id as SNAPSHOT_NOT_FOUND (no existence leak)", async () => {
    // The real `findSnapshotById` returns null when the row's
    // sessionId !== caller's sessionId (W3.1 contract). We simulate that
    // by having the mock return null for the cross-session id — the
    // handler cannot (and must not) distinguish this from "row doesn't
    // exist at all".
    snapshotMocks.findSnapshotById.mockImplementation(
      async (
        id: string,
        _userId: string,
        _sessionId: string,
      ): Promise<ReturnType<typeof makeSnapshotRow> | null> => {
        if (id === "snap-a") return makeSnapshotRow({ id: "snap-a" });
        // snap-from-other-session exists somewhere, but NOT in our scope.
        return null;
      },
    );

    const crossSessionResult = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-from-other-session",
    });

    expect(crossSessionResult.success).toBe(false);
    expect(crossSessionResult.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
    expect(crossSessionResult.data?.missingId).toBe("snap-from-other-session");

    // Critical: the error envelope for a cross-session id must be BYTE-IDENTICAL
    // in shape to the envelope for a genuinely non-existent id. The caller must
    // not be able to infer that the id actually exists elsewhere.
    snapshotMocks.findSnapshotById.mockImplementation(
      async (
        id: string,
      ): Promise<ReturnType<typeof makeSnapshotRow> | null> => {
        if (id === "snap-a") return makeSnapshotRow({ id: "snap-a" });
        return null;
      },
    );
    const genuinelyMissingResult = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-from-other-session", // same id, but now truly doesn't exist anywhere
    });
    expect(genuinelyMissingResult.error).toBe(crossSessionResult.error);
    expect(genuinelyMissingResult.data?.errorCode).toBe(
      crossSessionResult.data?.errorCode,
    );
    expect(genuinelyMissingResult.data?.missingId).toBe(
      crossSessionResult.data?.missingId,
    );
  });

  it("treats a cross-user id as SNAPSHOT_NOT_FOUND (no existence leak)", async () => {
    // Same contract as cross-session: `findSnapshotById` returns null for
    // mismatched userId, and the handler surfaces that as SNAPSHOT_NOT_FOUND.
    snapshotMocks.findSnapshotById.mockImplementation(
      async (
        id: string,
        _userId: string,
        _sessionId: string,
      ): Promise<ReturnType<typeof makeSnapshotRow> | null> => {
        if (id === "snap-a") return makeSnapshotRow({ id: "snap-a" });
        return null;
      },
    );

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-from-other-user",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
    expect(result.data?.missingId).toBe("snap-from-other-user");
    // The no-leak property: the error text echoes ONLY the caller-provided id,
    // never any other userId, sessionId, ownership, or "exists elsewhere" hint.
    // The error should contain the requested id (for actionability) and no
    // other identifier-shaped strings.
    expect(result.error ?? "").toContain("snap-from-other-user");
    expect(result.error ?? "").not.toMatch(/owned by|belongs to|exists for/i);
  });
});

// ---------------------------------------------------------------------------
// SNAPSHOT_DIFF_INVALID_INPUT — handler-level validation
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.diff input validation", () => {
  it("rejects missing `a` id with SNAPSHOT_DIFF_INVALID_INPUT before any DB read", async () => {
    const result = await runTool({
      action: "snapshot.diff",
      b: "snap-b",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");
    expect(snapshotMocks.findSnapshotById).not.toHaveBeenCalled();
  });

  it("rejects empty-string `a` id with SNAPSHOT_DIFF_INVALID_INPUT", async () => {
    const result = await runTool({
      action: "snapshot.diff",
      a: "   ",
      b: "snap-b",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");
    expect(snapshotMocks.findSnapshotById).not.toHaveBeenCalled();
  });

  it("rejects maxLines > 5000 with SNAPSHOT_DIFF_INVALID_INPUT", async () => {
    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
      maxLines: 5001,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");
    expect(snapshotMocks.findSnapshotById).not.toHaveBeenCalled();
  });

  it("rejects maxLines <= 0 with SNAPSHOT_DIFF_INVALID_INPUT", async () => {
    const resultZero = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
      maxLines: 0,
    });
    expect(resultZero.success).toBe(false);
    expect(resultZero.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");

    const resultNeg = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
      maxLines: -10,
    });
    expect(resultNeg.success).toBe(false);
    expect(resultNeg.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");

    expect(snapshotMocks.findSnapshotById).not.toHaveBeenCalled();
  });

  it("rejects non-integer maxLines with SNAPSHOT_DIFF_INVALID_INPUT", async () => {
    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
      maxLines: 42.5,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");
    expect(snapshotMocks.findSnapshotById).not.toHaveBeenCalled();
  });

  it("accepts maxLines at the exact boundary (5000) and returns a valid diff", async () => {
    mockFindByIdMap({
      "snap-a": makeSnapshotRow({ id: "snap-a", sourceCode: "a\n" }),
      "snap-b": makeSnapshotRow({ id: "snap-b", sourceCode: "b\n" }),
    });

    const result = await runTool({
      action: "snapshot.diff",
      a: "snap-a",
      b: "snap-b",
      maxLines: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.data?.sameContent).toBe(false);
  });
});
