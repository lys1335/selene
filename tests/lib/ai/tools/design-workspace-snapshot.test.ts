/**
 * Probe-level coverage for the Sprint 3 W3.1 `designWorkspace` snapshot.*
 * actions. Mocks the `snapshot-queries` + `service` modules so the test
 * exercises the tool handler logic (scope resolution, name validation,
 * sourceCode fallback, delete soft-return, cross-scope isolation) without
 * touching SQLite.
 *
 * Invariants under test:
 *
 *   1. snapshot.save (happy): persists a row with the caller-supplied
 *      `sourceCode` and returns a structured envelope carrying the
 *      `snapshot` row + `snapshotId` + `componentId`.
 *   2. snapshot.save (fallback): when `sourceCode` is omitted, the handler
 *      reads the component row via `findWorkspaceDesign` and uses its
 *      `code` field as the snapshot source.
 *   3. snapshot.save (miss): when the referenced component does not exist
 *      in scope, returns `SNAPSHOT_COMPONENT_NOT_FOUND`.
 *   4. snapshot.save: `name.length === SNAPSHOT_NAME_MAX_LENGTH` passes,
 *      `name.length === SNAPSHOT_NAME_MAX_LENGTH + 1` fails with
 *      `SNAPSHOT_NAME_TOO_LONG`.
 *   5. snapshot.pin: happy path returns the updated row; missing row emits
 *      `SNAPSHOT_NOT_FOUND`.
 *   6. snapshot.rename: `name: null` clears the name; 201-char name is
 *      rejected; missing row emits `SNAPSHOT_NOT_FOUND`.
 *   7. snapshot.list: over-cap `limit` surfaces `truncated: true` in the
 *      envelope.
 *   8. snapshot.delete: missing row returns `{success: true, deleted: false}`
 *      (soft miss, no SNAPSHOT_NOT_FOUND error); a genuine backend failure
 *      is surfaced via `SNAPSHOT_DELETE_FAILED`.
 *   9. Every handler rejects unscoped calls (no userId / no sessionId) with
 *      `INVALID_INPUT` before touching the DB.
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
    // Constants (SNAPSHOT_LIST_HARD_CAP, SNAPSHOT_NAME_MAX_LENGTH,
    // SnapshotCreateError) come from `...actual` — the handler references
    // them directly and the tests verify name-length boundaries against
    // the real constant value.
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
  withToolLogging: (_name: string, _sessionId: string | undefined, fn: (input: unknown) => Promise<unknown>) => fn,
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { createDesignWorkspaceTool } from "@/lib/ai/tools/design-workspace-tool";
import {
  SNAPSHOT_LIST_HARD_CAP,
  SNAPSHOT_NAME_MAX_LENGTH,
  SnapshotCreateError,
} from "@/lib/design/gallery/snapshot-queries";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const SESSION_ID = "sess-1";
const CHARACTER_ID = "char-1";
const COMPONENT_ID = "component-1";
const SNAPSHOT_ID_NEW = "snap-new";

function makeSnapshotRow(overrides: Record<string, unknown> = {}) {
  const base = {
    id: SNAPSHOT_ID_NEW,
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

function makeGalleryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPONENT_ID,
    userId: USER_ID,
    characterId: CHARACTER_ID,
    sessionId: SESSION_ID,
    projectId: null,
    name: "hero",
    description: null,
    prompt: "prompt",
    code: "export default function Hero() { return null; }",
    framework: "react-tailwind",
    category: "workspace",
    tags: [],
    styleTags: [],
    previewPath: null,
    mode: "tailwind",
    style: "default",
    useCount: 0,
    lastUsedAt: null,
    isFavorite: false,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    metadata: null,
    previewUrl: null,
    ...overrides,
  };
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
  const result = await (tool as unknown as {
    execute: (input: unknown) => Promise<unknown>;
  }).execute(input);
  return result as {
    success: boolean;
    action: string;
    error?: string;
    data?: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  galleryMocks.findWorkspaceDesign.mockResolvedValue(makeGalleryItem());
  snapshotMocks.createSnapshot.mockResolvedValue(makeSnapshotRow());
  snapshotMocks.findSnapshotById.mockResolvedValue(makeSnapshotRow());
  snapshotMocks.listSnapshots.mockResolvedValue([makeSnapshotRow()]);
  snapshotMocks.pinSnapshot.mockResolvedValue(
    makeSnapshotRow({ isPinned: true }),
  );
  snapshotMocks.renameSnapshot.mockResolvedValue(
    makeSnapshotRow({ name: "Checkpoint" }),
  );
  snapshotMocks.deleteSnapshot.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// snapshot.save
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.save", () => {
  it("persists a new row using the caller-supplied sourceCode and still validates componentId scope", async () => {
    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      sourceCode: "const CUSTOM = 1;",
      name: "pre-refactor",
      isPinned: true,
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("snapshot.save");
    // Rev-G W1 — scope check is now UNCONDITIONAL. Even when the caller
    // supplies their own `sourceCode`, we still verify the referenced
    // `componentId` belongs to the current (userId, sessionId) scope, so
    // an attacker cannot attach a foreign component's id to a snapshot
    // they own. The caller-supplied buffer still wins as the source, but
    // the component handle must be in-scope.
    expect(galleryMocks.findWorkspaceDesign).toHaveBeenCalledTimes(1);
    expect(galleryMocks.findWorkspaceDesign).toHaveBeenCalledWith({
      id: COMPONENT_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    expect(snapshotMocks.createSnapshot).toHaveBeenCalledTimes(1);
    const args = snapshotMocks.createSnapshot.mock.calls[0]![0];
    expect(args.userId).toBe(USER_ID);
    expect(args.sessionId).toBe(SESSION_ID);
    expect(args.componentId).toBe(COMPONENT_ID);
    // Caller-supplied sourceCode wins — the gallery `code` is NOT used
    // here even though findWorkspaceDesign runs for scope validation.
    expect(args.sourceCode).toBe("const CUSTOM = 1;");
    expect(args.name).toBe("pre-refactor");
    expect(args.isPinned).toBe(true);
    expect(typeof args.id).toBe("string");
    expect(result.data?.snapshot).toBeDefined();
    expect((result.data!.snapshot as { id: string }).id).toBe(SNAPSHOT_ID_NEW);
    expect(result.data?.snapshotId).toBe(SNAPSHOT_ID_NEW);
    expect(result.data?.componentId).toBe(COMPONENT_ID);
  });

  // Rev-G W1 — snapshot.save scope-leak regression.
  // ----------------------------------------------
  // Before Rev-G, the handler short-circuited past the componentId scope
  // lookup when the caller supplied an explicit `sourceCode`, which
  // meant any `design_components.id` (including another user's or
  // another session's) could be attached to the new snapshot row. Lock
  // in the fix: even with an explicit `sourceCode`, a cross-scope
  // componentId must be rejected with `SNAPSHOT_COMPONENT_NOT_FOUND`
  // and NO row inserted.
  it("rejects cross-scope componentId even when sourceCode is provided (W1 scope-leak)", async () => {
    // Simulate `findWorkspaceDesign` returning null because the
    // componentId does not belong to the current (userId, sessionId) —
    // i.e., a snapshot save pointed at some other user's component row.
    galleryMocks.findWorkspaceDesign.mockResolvedValue(null);

    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: "foreign-component",
      sourceCode: "const CUSTOM = 1;",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_COMPONENT_NOT_FOUND");
    expect(galleryMocks.findWorkspaceDesign).toHaveBeenCalledTimes(1);
    expect(snapshotMocks.createSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to the component's current `code` when sourceCode is omitted", async () => {
    galleryMocks.findWorkspaceDesign.mockResolvedValue(
      makeGalleryItem({ code: "export const INLINE = 'from-gallery';" }),
    );

    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
    });

    expect(result.success).toBe(true);
    expect(galleryMocks.findWorkspaceDesign).toHaveBeenCalledTimes(1);
    const args = snapshotMocks.createSnapshot.mock.calls[0]![0];
    expect(args.sourceCode).toBe("export const INLINE = 'from-gallery';");
  });

  it("emits SNAPSHOT_COMPONENT_NOT_FOUND when the component is absent (fallback path)", async () => {
    galleryMocks.findWorkspaceDesign.mockResolvedValue(null);

    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: "does-not-exist",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_COMPONENT_NOT_FOUND");
    expect(snapshotMocks.createSnapshot).not.toHaveBeenCalled();
  });

  it("accepts a name at exactly SNAPSHOT_NAME_MAX_LENGTH chars", async () => {
    const boundaryName = "a".repeat(SNAPSHOT_NAME_MAX_LENGTH);
    snapshotMocks.createSnapshot.mockResolvedValue(
      makeSnapshotRow({ name: boundaryName }),
    );

    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      sourceCode: "x",
      name: boundaryName,
    });

    expect(result.success).toBe(true);
    expect(snapshotMocks.createSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rejects a name at SNAPSHOT_NAME_MAX_LENGTH + 1 chars with SNAPSHOT_NAME_TOO_LONG", async () => {
    const overName = "a".repeat(SNAPSHOT_NAME_MAX_LENGTH + 1);

    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      sourceCode: "x",
      name: overName,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NAME_TOO_LONG");
    expect(snapshotMocks.createSnapshot).not.toHaveBeenCalled();
  });

  it("surfaces SnapshotCreateError as SNAPSHOT_SAVE_FAILED", async () => {
    snapshotMocks.createSnapshot.mockRejectedValue(
      new SnapshotCreateError("disk full"),
    );

    const result = await runTool({
      action: "snapshot.save",
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      sourceCode: "x",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_SAVE_FAILED");
  });

  it("rejects unscoped calls (missing userId) with INVALID_INPUT before touching the DB", async () => {
    const result = await runTool(
      {
        action: "snapshot.save",
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        sourceCode: "x",
      },
      { sessionId: SESSION_ID, userId: undefined, characterId: CHARACTER_ID },
    );

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("INVALID_INPUT");
    expect(snapshotMocks.createSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// snapshot.pin
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.pin", () => {
  it("pins a snapshot and returns the updated row", async () => {
    const result = await runTool({
      action: "snapshot.pin",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
      isPinned: true,
    });

    expect(result.success).toBe(true);
    expect(snapshotMocks.pinSnapshot).toHaveBeenCalledWith(
      SNAPSHOT_ID_NEW,
      USER_ID,
      SESSION_ID,
      true,
    );
    expect((result.data?.snapshot as { isPinned: boolean }).isPinned).toBe(true);
  });

  it("emits SNAPSHOT_NOT_FOUND when the snapshot row does not exist in scope", async () => {
    snapshotMocks.pinSnapshot.mockResolvedValue(null);

    const result = await runTool({
      action: "snapshot.pin",
      sessionId: SESSION_ID,
      snapshotId: "missing",
      isPinned: true,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
  });

  it("rejects calls missing snapshotId or isPinned with INVALID_INPUT", async () => {
    const result = await runTool({
      action: "snapshot.pin",
      sessionId: SESSION_ID,
      // snapshotId missing
      isPinned: true,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("INVALID_INPUT");
    expect(snapshotMocks.pinSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// snapshot.rename
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.rename", () => {
  it("renames a snapshot and returns the updated row", async () => {
    const result = await runTool({
      action: "snapshot.rename",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
      name: "After refactor",
    });

    expect(result.success).toBe(true);
    expect(snapshotMocks.renameSnapshot).toHaveBeenCalledWith(
      SNAPSHOT_ID_NEW,
      USER_ID,
      SESSION_ID,
      "After refactor",
    );
  });

  it("accepts `name: null` to clear the name", async () => {
    snapshotMocks.renameSnapshot.mockResolvedValue(
      makeSnapshotRow({ name: null }),
    );

    const result = await runTool({
      action: "snapshot.rename",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
      name: null,
    });

    expect(result.success).toBe(true);
    expect(snapshotMocks.renameSnapshot).toHaveBeenCalledWith(
      SNAPSHOT_ID_NEW,
      USER_ID,
      SESSION_ID,
      null,
    );
  });

  it("rejects a 201-char name with SNAPSHOT_NAME_TOO_LONG", async () => {
    const overName = "b".repeat(SNAPSHOT_NAME_MAX_LENGTH + 1);

    const result = await runTool({
      action: "snapshot.rename",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
      name: overName,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NAME_TOO_LONG");
    expect(snapshotMocks.renameSnapshot).not.toHaveBeenCalled();
  });

  it("emits SNAPSHOT_NOT_FOUND when the row does not exist in scope", async () => {
    snapshotMocks.renameSnapshot.mockResolvedValue(null);

    const result = await runTool({
      action: "snapshot.rename",
      sessionId: SESSION_ID,
      snapshotId: "missing",
      name: "x",
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// snapshot.list
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.list", () => {
  it("returns the list unchanged and omits `truncated` on under-cap queries", async () => {
    snapshotMocks.listSnapshots.mockResolvedValue([
      makeSnapshotRow({ id: "a" }),
      makeSnapshotRow({ id: "b" }),
    ]);

    const result = await runTool({
      action: "snapshot.list",
      sessionId: SESSION_ID,
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data?.snapshots)).toBe(true);
    expect((result.data!.snapshots as unknown[]).length).toBe(2);
    expect(result.data?.truncated).toBeFalsy();
  });

  it("flags `truncated: true` when the caller requests above SNAPSHOT_LIST_HARD_CAP", async () => {
    snapshotMocks.listSnapshots.mockResolvedValue(
      Array.from({ length: SNAPSHOT_LIST_HARD_CAP }, (_unused, idx) =>
        makeSnapshotRow({ id: `snap-${idx}` }),
      ),
    );

    const result = await runTool({
      action: "snapshot.list",
      sessionId: SESSION_ID,
      limit: SNAPSHOT_LIST_HARD_CAP + 50,
    });

    expect(result.success).toBe(true);
    expect(result.data?.truncated).toBe(true);
    expect(
      (result.data!.snapshots as unknown[]).length,
    ).toBe(SNAPSHOT_LIST_HARD_CAP);
  });

  it("forwards `componentId` + `isPinnedOnly` filters to the query layer", async () => {
    await runTool({
      action: "snapshot.list",
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      isPinnedOnly: true,
    });

    expect(snapshotMocks.listSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        isPinnedOnly: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// snapshot.delete
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot.delete", () => {
  it("returns success:true, deleted:true on a real hit", async () => {
    snapshotMocks.deleteSnapshot.mockResolvedValue(true);

    const result = await runTool({
      action: "snapshot.delete",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
    });

    expect(result.success).toBe(true);
    expect(result.data?.deleted).toBe(true);
    expect(result.data?.snapshotId).toBe(SNAPSHOT_ID_NEW);
  });

  it("soft-returns success:true, deleted:false on a miss (no SNAPSHOT_NOT_FOUND error)", async () => {
    snapshotMocks.deleteSnapshot.mockResolvedValue(false);

    const result = await runTool({
      action: "snapshot.delete",
      sessionId: SESSION_ID,
      snapshotId: "does-not-exist",
    });

    expect(result.success).toBe(true);
    expect(result.data?.deleted).toBe(false);
    expect(result.data?.errorCode).toBeUndefined();
  });

  it("surfaces backend failures as SNAPSHOT_DELETE_FAILED", async () => {
    snapshotMocks.deleteSnapshot.mockRejectedValue(new Error("disk error"));

    const result = await runTool({
      action: "snapshot.delete",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("SNAPSHOT_DELETE_FAILED");
  });

  it("rejects calls without snapshotId with INVALID_INPUT", async () => {
    const result = await runTool({
      action: "snapshot.delete",
      sessionId: SESSION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.data?.errorCode).toBe("INVALID_INPUT");
    expect(snapshotMocks.deleteSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cross-scope existence-leak regression
// ---------------------------------------------------------------------------

describe("designWorkspace — snapshot scope isolation", () => {
  it("passes the tool's userId + sessionId through to every query call", async () => {
    await runTool({
      action: "snapshot.pin",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
      isPinned: true,
    });
    expect(snapshotMocks.pinSnapshot).toHaveBeenCalledWith(
      SNAPSHOT_ID_NEW,
      USER_ID,
      SESSION_ID,
      true,
    );

    await runTool({
      action: "snapshot.rename",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
      name: "x",
    });
    expect(snapshotMocks.renameSnapshot).toHaveBeenCalledWith(
      SNAPSHOT_ID_NEW,
      USER_ID,
      SESSION_ID,
      "x",
    );

    await runTool({
      action: "snapshot.delete",
      sessionId: SESSION_ID,
      snapshotId: SNAPSHOT_ID_NEW,
    });
    expect(snapshotMocks.deleteSnapshot).toHaveBeenCalledWith(
      SNAPSHOT_ID_NEW,
      USER_ID,
      SESSION_ID,
    );

    await runTool({
      action: "snapshot.list",
      sessionId: SESSION_ID,
    });
    expect(snapshotMocks.listSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, sessionId: SESSION_ID }),
    );
  });
});
