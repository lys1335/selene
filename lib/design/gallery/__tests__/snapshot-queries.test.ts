/**
 * Coverage for `lib/design/gallery/snapshot-queries.ts` (Sprint 3 W3.1).
 *
 * Drives the query module end-to-end against a real better-sqlite3 instance
 * backed by a temp-directory DB — stays millisecond-scale without mocking
 * drizzle. `LOCAL_DATA_PATH` is pinned to a temp directory via `vi.hoisted`
 * so the assignment runs BEFORE any module import, which is critical because
 * `@/lib/db/sqlite-client` evaluates `getDbPath()` at import time. If the
 * env var were set in a plain top-level statement, the sqlite-client module
 * would already be initialized against the developer's real DB.
 *
 * Invariants under test:
 *
 *   1. create / find / list round-trip.
 *   2. Scoping: cross-user + cross-session reads return `null` (never leak
 *      existence across scopes).
 *   3. `listSnapshots` orders newest-first, respects `isPinnedOnly`,
 *      `componentId`, and clamps `limit` to `SNAPSHOT_LIST_HARD_CAP`.
 *   4. `pinSnapshot` / `renameSnapshot` update + bump `updated_at`; cross-
 *      scope calls return `null`.
 *   5. `deleteSnapshot` returns `true` on hit, `false` on miss / cross-scope
 *      — never throws for "row not found".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

// Hoisted env-var assignment runs BEFORE any static imports at the top of
// this file — which means the first `import` of `@/lib/db/sqlite-client`
// sees our temp directory, not the developer's real DB path. We `require`
// node's built-ins here because vi.hoisted runs before ES-module imports
// are bound.
const hoistedEnv = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  const tempDir = mkdtempSync(join(tmpdir(), "snapshot-queries-test-"));
  process.env.LOCAL_DATA_PATH = tempDir;
  return { tempDir };
});

import {
  SNAPSHOT_LIST_HARD_CAP,
  createSnapshot,
  deleteSnapshot,
  findSnapshotById,
  listSnapshots,
  pinSnapshot,
  renameSnapshot,
} from "@/lib/design/gallery/snapshot-queries";
import { db } from "@/lib/db/sqlite-client";
import { designSnapshots } from "@/lib/db/schema/design-snapshots";
import { designComponents } from "@/lib/db/schema/design-gallery";
import { users } from "@/lib/db/sqlite-schema-base";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = "user-a-snap-test";
const USER_B = "user-b-snap-test";
const SESS_1 = "sess-1-snap-test";
const SESS_2 = "sess-2-snap-test";

let compAId: string;
let compBId: string;
let compBOwnedId: string;

async function seedUserIfMissing(userId: string): Promise<void> {
  // The design_components table holds a FK to users(id). Upsert the user
  // row so the component inserts below don't violate the FK.
  await db
    .insert(users)
    .values({
      id: userId,
      email: `${userId}@test.local`,
    })
    .onConflictDoNothing();
}

async function seedComponent(params: {
  id: string;
  userId: string;
  sessionId: string;
  name?: string;
}): Promise<void> {
  await db.insert(designComponents).values({
    id: params.id,
    userId: params.userId,
    sessionId: null, // Leave null — the sessions FK is ON DELETE SET NULL;
                     // we don't actually need a session row for these tests.
    name: params.name ?? "fixture",
    prompt: "fixture prompt",
    code: "export default function F() { return null; }",
  });
}

async function createFixtureSnapshot(overrides: {
  id: string;
  userId?: string;
  sessionId?: string;
  componentId: string;
  name?: string | null;
  isPinned?: boolean;
  sourceCode?: string;
}) {
  return createSnapshot({
    id: overrides.id,
    userId: overrides.userId ?? USER_A,
    sessionId: overrides.sessionId ?? SESS_1,
    componentId: overrides.componentId,
    sourceCode: overrides.sourceCode ?? "const A = 1;",
    name: overrides.name ?? null,
    isPinned: overrides.isPinned ?? false,
  });
}

beforeAll(async () => {
  await seedUserIfMissing(USER_A);
  await seedUserIfMissing(USER_B);

  compAId = "comp-a-" + Math.random().toString(36).slice(2, 10);
  compBId = "comp-b-" + Math.random().toString(36).slice(2, 10);
  compBOwnedId = "comp-b-owned-" + Math.random().toString(36).slice(2, 10);
  await seedComponent({ id: compAId, userId: USER_A, sessionId: SESS_1, name: "compA" });
  await seedComponent({ id: compBId, userId: USER_A, sessionId: SESS_1, name: "compB" });
  await seedComponent({
    id: compBOwnedId,
    userId: USER_B,
    sessionId: SESS_1,
    name: "compBOwned",
  });
});

afterAll(() => {
  try {
    rmSync(hoistedEnv.tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(async () => {
  // Wipe the snapshots table so each test starts from a clean slate. The
  // seeded components / users / etc. are preserved across tests.
  await db.delete(designSnapshots);
});

// Touch `sql` so the import stays local to the module graph.
void sql;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("snapshot-queries: createSnapshot + findSnapshotById", () => {
  it("round-trips a new snapshot row", async () => {
    const inserted = await createFixtureSnapshot({
      id: "snap-1",
      componentId: compAId,
      name: "first cut",
      isPinned: false,
      sourceCode: "const X = 42;",
    });

    expect(inserted.id).toBe("snap-1");
    expect(inserted.userId).toBe(USER_A);
    expect(inserted.sessionId).toBe(SESS_1);
    expect(inserted.componentId).toBe(compAId);
    expect(inserted.name).toBe("first cut");
    expect(inserted.isPinned).toBe(false);
    expect(inserted.sourceCode).toBe("const X = 42;");
    expect(typeof inserted.createdAt).toBe("string");
    expect(typeof inserted.updatedAt).toBe("string");

    const found = await findSnapshotById("snap-1", USER_A, SESS_1);
    expect(found).not.toBeNull();
    expect(found!.id).toBe("snap-1");
    expect(found!.sourceCode).toBe("const X = 42;");
    expect(found!.isPinned).toBe(false);
  });

  it("findSnapshotById returns null for cross-user scope (no existence leak)", async () => {
    await createFixtureSnapshot({ id: "snap-1", componentId: compAId });
    const leaked = await findSnapshotById("snap-1", USER_B, SESS_1);
    expect(leaked).toBeNull();
  });

  it("findSnapshotById returns null for cross-session scope (no existence leak)", async () => {
    await createFixtureSnapshot({ id: "snap-1", componentId: compAId });
    const leaked = await findSnapshotById("snap-1", USER_A, SESS_2);
    expect(leaked).toBeNull();
  });

  it("findSnapshotById returns null for a non-existent id", async () => {
    const found = await findSnapshotById("does-not-exist", USER_A, SESS_1);
    expect(found).toBeNull();
  });
});

describe("snapshot-queries: listSnapshots", () => {
  it("orders newest-first by createdAt", async () => {
    await createFixtureSnapshot({ id: "old", componentId: compAId });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await createFixtureSnapshot({ id: "mid", componentId: compAId });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await createFixtureSnapshot({ id: "new", componentId: compAId });

    const rows = await listSnapshots({ userId: USER_A, sessionId: SESS_1 });
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("filters by isPinnedOnly", async () => {
    await createFixtureSnapshot({ id: "a", componentId: compAId, isPinned: false });
    await createFixtureSnapshot({ id: "b", componentId: compAId, isPinned: true });
    await createFixtureSnapshot({ id: "c", componentId: compAId, isPinned: true });

    const pinned = await listSnapshots({
      userId: USER_A,
      sessionId: SESS_1,
      isPinnedOnly: true,
    });
    expect(pinned.map((r) => r.id).sort()).toEqual(["b", "c"]);
    expect(pinned.every((r) => r.isPinned)).toBe(true);
  });

  it("filters by componentId", async () => {
    await createFixtureSnapshot({ id: "a", componentId: compAId });
    await createFixtureSnapshot({ id: "b", componentId: compBId });

    const rowsA = await listSnapshots({
      userId: USER_A,
      sessionId: SESS_1,
      componentId: compAId,
    });
    expect(rowsA.map((r) => r.id)).toEqual(["a"]);

    const rowsB = await listSnapshots({
      userId: USER_A,
      sessionId: SESS_1,
      componentId: compBId,
    });
    expect(rowsB.map((r) => r.id)).toEqual(["b"]);
  });

  it("clamps limit to SNAPSHOT_LIST_HARD_CAP", async () => {
    for (let i = 0; i < 5; i++) {
      await createFixtureSnapshot({ id: `snap-${i}`, componentId: compAId });
    }

    const overCap = await listSnapshots({
      userId: USER_A,
      sessionId: SESS_1,
      limit: SNAPSHOT_LIST_HARD_CAP + 50,
    });
    expect(overCap.length).toBe(5);

    const tiny = await listSnapshots({
      userId: USER_A,
      sessionId: SESS_1,
      limit: 0,
    });
    expect(tiny.length).toBe(1);
  });

  it("never returns rows owned by another user or session", async () => {
    await createFixtureSnapshot({
      id: "a",
      userId: USER_A,
      sessionId: SESS_1,
      componentId: compAId,
    });
    await createFixtureSnapshot({
      id: "b",
      userId: USER_B,
      sessionId: SESS_1,
      componentId: compBOwnedId,
    });

    const rowsA = await listSnapshots({ userId: USER_A, sessionId: SESS_1 });
    const rowsB = await listSnapshots({ userId: USER_B, sessionId: SESS_1 });
    expect(rowsA.map((r) => r.id)).toEqual(["a"]);
    expect(rowsB.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("snapshot-queries: pinSnapshot", () => {
  it("pins then unpins a snapshot, bumping updated_at each time", async () => {
    const created = await createFixtureSnapshot({
      id: "snap-1",
      componentId: compAId,
      isPinned: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const pinned = await pinSnapshot("snap-1", USER_A, SESS_1, true);
    expect(pinned).not.toBeNull();
    expect(pinned!.isPinned).toBe(true);
    expect(pinned!.updatedAt >= created.updatedAt).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 15));
    const unpinned = await pinSnapshot("snap-1", USER_A, SESS_1, false);
    expect(unpinned).not.toBeNull();
    expect(unpinned!.isPinned).toBe(false);
    expect(unpinned!.updatedAt >= pinned!.updatedAt).toBe(true);
  });

  it("returns null on cross-user scope (no existence leak)", async () => {
    await createFixtureSnapshot({ id: "snap-1", componentId: compAId });
    const leaked = await pinSnapshot("snap-1", USER_B, SESS_1, true);
    expect(leaked).toBeNull();

    const row = await findSnapshotById("snap-1", USER_A, SESS_1);
    expect(row!.isPinned).toBe(false);
  });

  it("returns null for a non-existent id", async () => {
    const missing = await pinSnapshot("nope", USER_A, SESS_1, true);
    expect(missing).toBeNull();
  });
});

describe("snapshot-queries: renameSnapshot", () => {
  it("renames a snapshot and bumps updated_at", async () => {
    const created = await createFixtureSnapshot({
      id: "snap-1",
      componentId: compAId,
      name: null,
    });
    expect(created.name).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 15));

    const named = await renameSnapshot("snap-1", USER_A, SESS_1, "Checkpoint A");
    expect(named).not.toBeNull();
    expect(named!.name).toBe("Checkpoint A");
    expect(named!.updatedAt >= created.updatedAt).toBe(true);

    const cleared = await renameSnapshot("snap-1", USER_A, SESS_1, null);
    expect(cleared).not.toBeNull();
    expect(cleared!.name).toBeNull();
  });

  it("returns null on cross-session scope (no existence leak)", async () => {
    await createFixtureSnapshot({ id: "snap-1", componentId: compAId });
    const leaked = await renameSnapshot("snap-1", USER_A, SESS_2, "x");
    expect(leaked).toBeNull();
  });
});

describe("snapshot-queries: deleteSnapshot", () => {
  it("returns true on a real hit and removes the row", async () => {
    await createFixtureSnapshot({ id: "snap-1", componentId: compAId });

    const result = await deleteSnapshot("snap-1", USER_A, SESS_1);
    expect(result).toBe(true);

    const row = await findSnapshotById("snap-1", USER_A, SESS_1);
    expect(row).toBeNull();
  });

  it("returns false for a cross-user miss (no existence leak)", async () => {
    await createFixtureSnapshot({ id: "snap-1", componentId: compAId });

    const result = await deleteSnapshot("snap-1", USER_B, SESS_1);
    expect(result).toBe(false);

    const row = await findSnapshotById("snap-1", USER_A, SESS_1);
    expect(row).not.toBeNull();
  });

  it("returns false for a non-existent id (never throws)", async () => {
    const result = await deleteSnapshot("does-not-exist", USER_A, SESS_1);
    expect(result).toBe(false);
  });
});
