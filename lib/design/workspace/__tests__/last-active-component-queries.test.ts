/**
 * Coverage for `lib/design/workspace/last-active-component-queries.ts`
 * (Sprint 4 W4.3 — persisted pointer).
 *
 * Drives the module end-to-end against a real better-sqlite3 instance
 * backed by a temp-directory DB — stays millisecond-scale without
 * mocking drizzle. `LOCAL_DATA_PATH` is pinned via `vi.hoisted` so the
 * env var is set BEFORE `@/lib/db/sqlite-client` evaluates `getDbPath`
 * at import time. The sqlite-client otherwise captures the real
 * developer DB path on first import.
 *
 * Invariants under test:
 *   1. Happy path: set-then-get round-trips the pointer.
 *   2. Scope enforcement: set rejects cross-session component ids with
 *      `COMPONENT_SCOPE_MISMATCH`; cross-user session ids with
 *      `SESSION_SCOPE_MISMATCH`. The existence of another user's
 *      component is never leaked — a non-scoped id reads as
 *      `COMPONENT_NOT_FOUND`.
 *   3. Stale pointer: when the pointed-at component is deleted
 *      out-of-band (or the session id is reassigned), `get` returns
 *      `null` AND clears the persisted pointer as a self-heal.
 *   4. Clear path: passing `componentId: null` clears the pointer
 *      under the correct scope; a cross-scope clear is still
 *      rejected.
 *   5. Unknown session id returns `SESSION_NOT_FOUND` with no write.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

const hoistedEnv = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  const tempDir = mkdtempSync(join(tmpdir(), "last-active-component-test-"));
  process.env.LOCAL_DATA_PATH = tempDir;
  return { tempDir };
});

import {
  getLastActiveComponentId,
  setLastActiveComponentId,
} from "@/lib/design/workspace/last-active-component-queries";
import { db } from "@/lib/db/sqlite-client";
import { sessions, users } from "@/lib/db/sqlite-schema-base";
import { designComponents } from "@/lib/db/schema/design-gallery";
import { eq } from "drizzle-orm";

const USER_A = "user-a-lac-test";
const USER_B = "user-b-lac-test";
const SESS_A = "sess-a-lac-test";
const SESS_B = "sess-b-lac-test";
const SESS_OTHER_USER = "sess-other-user-lac-test";

async function seedUser(userId: string): Promise<void> {
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test.local` })
    .onConflictDoNothing();
}

async function seedSession(id: string, userId: string): Promise<void> {
  await db
    .insert(sessions)
    .values({ id, userId })
    .onConflictDoNothing();
}

async function seedComponent(opts: {
  id: string;
  userId: string;
  sessionId: string | null;
}): Promise<void> {
  await db
    .insert(designComponents)
    .values({
      id: opts.id,
      userId: opts.userId,
      sessionId: opts.sessionId,
      name: "fixture",
      prompt: "prompt",
      code: "export default function F() { return null; }",
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  await seedUser(USER_A);
  await seedUser(USER_B);
  await seedSession(SESS_A, USER_A);
  await seedSession(SESS_B, USER_A);
  await seedSession(SESS_OTHER_USER, USER_B);
});

afterAll(() => {
  try {
    rmSync(hoistedEnv.tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(async () => {
  // Fresh component rows per test. Clear the pointer on the scoped
  // sessions so each test starts clean. The users / sessions rows are
  // preserved across tests.
  await db.delete(designComponents);
  await db
    .update(sessions)
    .set({ lastActiveComponentId: null })
    .where(eq(sessions.id, SESS_A));
  await db
    .update(sessions)
    .set({ lastActiveComponentId: null })
    .where(eq(sessions.id, SESS_B));
  await db
    .update(sessions)
    .set({ lastActiveComponentId: null })
    .where(eq(sessions.id, SESS_OTHER_USER));
});

describe("setLastActiveComponentId + getLastActiveComponentId: happy path", () => {
  it("round-trips a pointer under the same (userId, sessionId) scope", async () => {
    await seedComponent({ id: "comp-1", userId: USER_A, sessionId: SESS_A });

    const setResult = await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: "comp-1",
    });
    expect(setResult.ok).toBe(true);
    if (setResult.ok) {
      expect(setResult.lastActiveComponentId).toBe("comp-1");
    }

    const got = await getLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
    });
    expect(got).toBe("comp-1");
  });

  it("clears the pointer when componentId === null", async () => {
    await seedComponent({ id: "comp-1", userId: USER_A, sessionId: SESS_A });
    await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: "comp-1",
    });

    const cleared = await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: null,
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.lastActiveComponentId).toBeNull();
    }

    const got = await getLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
    });
    expect(got).toBeNull();
  });
});

describe("setLastActiveComponentId: scope enforcement", () => {
  it("rejects cross-session componentId with COMPONENT_SCOPE_MISMATCH", async () => {
    // Component lives in SESS_A; caller tries to persist it on SESS_B.
    await seedComponent({ id: "comp-1", userId: USER_A, sessionId: SESS_A });

    const result = await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_B,
      componentId: "comp-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("COMPONENT_SCOPE_MISMATCH");
    }

    // Pointer on SESS_B stays null — write must not leak through.
    const pointer = await getLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_B,
    });
    expect(pointer).toBeNull();
  });

  it("rejects another user's session with SESSION_SCOPE_MISMATCH", async () => {
    await seedComponent({
      id: "comp-1",
      userId: USER_B,
      sessionId: SESS_OTHER_USER,
    });

    const result = await setLastActiveComponentId({
      userId: USER_A, // attacker
      sessionId: SESS_OTHER_USER, // victim
      componentId: "comp-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SESSION_SCOPE_MISMATCH");
    }

    // Victim's pointer must not change.
    const pointer = await getLastActiveComponentId({
      userId: USER_B,
      sessionId: SESS_OTHER_USER,
    });
    expect(pointer).toBeNull();
  });

  it("returns COMPONENT_NOT_FOUND for a wholly unknown componentId", async () => {
    const result = await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: "nope-not-a-real-id",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("COMPONENT_NOT_FOUND");
    }
  });

  it("returns SESSION_NOT_FOUND when sessionId doesn't exist", async () => {
    const result = await setLastActiveComponentId({
      userId: USER_A,
      sessionId: "this-session-never-existed",
      componentId: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("getLastActiveComponentId: stale pointer handling", () => {
  it("returns null and self-heals when the pointed-at component is deleted", async () => {
    await seedComponent({ id: "comp-1", userId: USER_A, sessionId: SESS_A });
    await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: "comp-1",
    });

    // Simulate out-of-band deletion (e.g., direct DB access bypassing the
    // FK cascade, or an FK that was disabled when the component was
    // inserted through a different path). Use `foreign_keys = OFF` so
    // better-sqlite3 lets us leave the pointer in place even though the
    // component row is gone — otherwise the FK cascade nulls the pointer
    // before `getLastActiveComponentId` even runs and the self-heal
    // branch never exercises.
    (db.$client as { pragma: (stmt: string) => unknown }).pragma(
      "foreign_keys = OFF",
    );
    try {
      await db.delete(designComponents).where(eq(designComponents.id, "comp-1"));
    } finally {
      (db.$client as { pragma: (stmt: string) => unknown }).pragma(
        "foreign_keys = ON",
      );
    }

    // Pointer now references a missing row.
    const got = await getLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
    });
    expect(got).toBeNull();

    // Self-heal: the stale pointer was cleared on the session row, so a
    // second read still returns null without further DB churn (and
    // without the rest of the workspace re-observing the dead id).
    const second = await getLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
    });
    expect(second).toBeNull();

    const row = await db.query.sessions.findFirst({
      where: eq(sessions.id, SESS_A),
    });
    expect(row?.lastActiveComponentId).toBeNull();
  });

  it("returns null when the caller's scope doesn't match the pointer's owner", async () => {
    // Cross-user read: set a pointer under USER_A then try to read it as
    // USER_B. Must not leak the componentId.
    await seedComponent({ id: "comp-1", userId: USER_A, sessionId: SESS_A });
    await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: "comp-1",
    });

    const leaked = await getLastActiveComponentId({
      userId: USER_B,
      sessionId: SESS_A,
    });
    expect(leaked).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sprint 4 W4.3 — Rev-J2 (M3): delete-between-check-and-update race.
//
// Previously `setLastActiveComponentId` ran the existence check and the
// UPDATE as two independent DB round-trips. If the target component was
// deleted between the two, the FK on `sessions.last_active_component_id`
// would fire `SQLITE_CONSTRAINT_FOREIGNKEY` and the error would escape as
// an HTTP 500 — instead of the intended stale/null/not-found outcome.
//
// The new implementation wraps both statements in a single `db.transaction`
// AND catches FK constraint failures from the UPDATE, translating them
// into the structured `COMPONENT_NOT_FOUND` result envelope. These tests
// lock in both limbs: the happy-path "component already deleted before the
// call" returns structured null without throwing; the FK-catch fallback
// translates a raised FK error into the same shape.
// ---------------------------------------------------------------------------
describe("setLastActiveComponentId: delete-between-check-and-update race (M3)", () => {
  it("returns structured COMPONENT_NOT_FOUND (not a thrown 500) when the componentId was deleted before the call", async () => {
    await seedComponent({ id: "comp-1", userId: USER_A, sessionId: SESS_A });

    // Mid-flight deletion: in production this happens in the race window,
    // in the test we delete BEFORE the call — the atomic transaction
    // inside `setLastActiveComponentId` will see the row missing and
    // return the structured result instead of throwing.
    await db.delete(designComponents).where(eq(designComponents.id, "comp-1"));

    const result = await setLastActiveComponentId({
      userId: USER_A,
      sessionId: SESS_A,
      componentId: "comp-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("COMPONENT_NOT_FOUND");
    }

    // Session row pointer must remain null — no partial write leaked.
    const row = await db.query.sessions.findFirst({
      where: eq(sessions.id, SESS_A),
    });
    expect(row?.lastActiveComponentId).toBeNull();
  });

  it("catches a raised FK constraint error from the UPDATE and translates it to COMPONENT_NOT_FOUND", async () => {
    // Direct simulation of the pathological post-check-pre-update race:
    // the in-transaction read succeeds, then the FK fires on the write.
    // We exercise this by calling setLastActiveComponentId with a
    // componentId that exists at select time but whose FK enforcement
    // misfires on write. The easiest reproducible substitute: use
    // `foreign_keys = OFF` to skip the FK during the read-then-update
    // path isn't quite right — instead we trigger a true FK failure by
    // pointing the sessions.last_active_component_id column at a deleted
    // id directly. The transaction's WHERE (id, userId) still matches
    // the row, and the FK fires on commit because the new pointer value
    // (`componentId`) doesn't resolve.
    //
    // We pass a componentId that DOES exist so the in-transaction check
    // passes, then delete it via foreign_keys=OFF AFTER the lookup-time
    // moment but before the UPDATE commits. Since better-sqlite3 runs
    // the whole transaction synchronously on a single connection, we
    // can't hot-swap between statements — so we simulate by pre-inserting
    // a row whose FK will fail regardless. Concretely: temporarily
    // disable FK, insert a "ghost" component whose `id` has an FK-
    // incompatible companion state we craft below, then re-enable FK and
    // call `setLastActiveComponentId`. The UPDATE will fail as
    // SQLITE_CONSTRAINT_FOREIGNKEY and our catch branch must translate
    // to COMPONENT_NOT_FOUND.
    //
    // Setup trick: insert a component that passes our existence check
    // (same (userId, sessionId) scope) but whose row is missing at
    // commit time. We achieve that by deleting the row with
    // foreign_keys = OFF AFTER we pass the transaction's select but
    // BEFORE the transaction commits — impossible to orchestrate from
    // the outside on a sync API. So we take a different route: we
    // directly assert the catch branch by forcing the UPDATE statement
    // to throw via a spy on the underlying sqlite client.
    const pragmaClient = db.$client as unknown as {
      prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
    };
    const originalPrepare = pragmaClient.prepare.bind(pragmaClient);

    await seedComponent({ id: "comp-ghost", userId: USER_A, sessionId: SESS_A });

    // Intercept the next UPDATE statement on `sessions` and replace its
    // `run` with a thrower that mimics the better-sqlite3 FK error shape.
    let patched = false;
    pragmaClient.prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (!patched && /update\s+["`]?sessions/i.test(sql)) {
        patched = true;
        const originalRun = stmt.run.bind(stmt);
        stmt.run = () => {
          void originalRun;
          const err = new Error(
            "FOREIGN KEY constraint failed",
          ) as Error & { code?: string };
          err.code = "SQLITE_CONSTRAINT_FOREIGNKEY";
          throw err;
        };
      }
      return stmt;
    }) as typeof pragmaClient.prepare;

    try {
      const result = await setLastActiveComponentId({
        userId: USER_A,
        sessionId: SESS_A,
        componentId: "comp-ghost",
      });

      // Structured envelope, not a thrown 500.
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("COMPONENT_NOT_FOUND");
        // Message must still be agent-actionable, never a bare "500".
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
      }
    } finally {
      pragmaClient.prepare = originalPrepare;
    }
  });
});
