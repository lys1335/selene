/**
 * SqliteContentStore integration tests.
 *
 * Exercises the persistent backing for storeFullContent / retrieveFullContent
 * to verify:
 *   - Round-trip: store returns an id, retrieve returns the exact row
 *   - TTL expiry: retrieve returns null once expires_at < now, and
 *     the expired row is proactively deleted on read
 *   - Cascade delete: removing the owning session drops its truncated rows
 *   - FK fallback: inserting with an unknown sessionId returns null
 *     (so callers can degrade to an inline preview) and logs once
 *   - clearSession / cleanupExpired / list / sessionHasContent
 *
 * These tests construct SqliteContentStore directly — the module-level
 * `activeStore` in tests/setup.ts is still InMemory, so no ambient state
 * leaks between the two.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/sqlite-client";
import { sessions, truncatedContent } from "@/lib/db/sqlite-schema-base";
import { SqliteContentStore } from "@/lib/ai/truncated-content-store/sqlite";

// Stable UUID-looking session IDs so FK inserts don't collide across test runs.
const TEST_SESSION_PREFIX = "test-trunc-sqlite-";

function uniqueSessionId(label: string): string {
  return `${TEST_SESSION_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestSession(id: string): Promise<void> {
  await db
    .insert(sessions)
    .values({
      id,
      title: `trunc-sqlite-test ${id}`,
      status: "active",
    })
    .run();
}

async function deleteTestSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id)).run();
}

describe("SqliteContentStore", () => {
  let store: SqliteContentStore;
  const createdSessionIds: string[] = [];

  beforeAll(() => {
    store = new SqliteContentStore();
  });

  beforeEach(() => {
    // Silence the 5-minute-cooldown warn spam for FK-violation test paths.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(async () => {
    // Clean up all sessions this suite created. The CASCADE FK will also
    // drop any leftover truncated_content rows automatically.
    for (const id of createdSessionIds) {
      try {
        await deleteTestSession(id);
      } catch {
        /* best-effort */
      }
    }
  });

  it("round-trips stored content via id", async () => {
    const sessionId = uniqueSessionId("roundtrip");
    createdSessionIds.push(sessionId);
    await createTestSession(sessionId);

    const id = store.store(
      sessionId,
      "webSearch output",
      "full raw content body",
      42,
    );
    expect(id).not.toBeNull();
    expect(id).toMatch(/^trunc_/);

    const entry = store.retrieve(sessionId, id!);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(id);
    expect(entry!.sessionId).toBe(sessionId);
    expect(entry!.context).toBe("webSearch output");
    expect(entry!.fullContent).toBe("full raw content body");
    expect(entry!.fullLength).toBe("full raw content body".length);
    expect(entry!.truncatedLength).toBe(42);
    expect(entry!.storedAt).toBeInstanceOf(Date);
    expect(entry!.expiresAt).toBeInstanceOf(Date);
    expect(entry!.expiresAt.getTime()).toBeGreaterThan(entry!.storedAt.getTime());
  });

  it("returns null and evicts row when TTL has expired", async () => {
    const sessionId = uniqueSessionId("ttl");
    createdSessionIds.push(sessionId);
    await createTestSession(sessionId);

    // Store with a 1ms TTL so it is expired by the time we retrieve.
    const id = store.store(sessionId, "tiny ttl", "body", 4, 1);
    expect(id).not.toBeNull();

    // Wait past the TTL.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const entry = store.retrieve(sessionId, id!);
    expect(entry).toBeNull();

    // Row should have been deleted proactively by retrieve().
    const rows = db
      .select()
      .from(truncatedContent)
      .where(eq(truncatedContent.id, id!))
      .all();
    expect(rows).toHaveLength(0);
  });

  it("cleanupExpired removes all past-expiry rows", async () => {
    const sessionId = uniqueSessionId("cleanup");
    createdSessionIds.push(sessionId);
    await createTestSession(sessionId);

    const expiredA = store.store(sessionId, "a", "aaa", 0, 1);
    const expiredB = store.store(sessionId, "b", "bbb", 0, 1);
    const alive = store.store(sessionId, "c", "ccc", 0, 10 * 60 * 1000);

    expect(expiredA).not.toBeNull();
    expect(expiredB).not.toBeNull();
    expect(alive).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const removed = store.cleanupExpired();
    // At least the two we just expired — other tests in this run may add more.
    expect(removed).toBeGreaterThanOrEqual(2);

    expect(store.retrieve(sessionId, expiredA!)).toBeNull();
    expect(store.retrieve(sessionId, expiredB!)).toBeNull();
    expect(store.retrieve(sessionId, alive!)).not.toBeNull();
  });

  it("cascades delete from sessions → truncated_content", async () => {
    const sessionId = uniqueSessionId("cascade");
    // Intentionally do NOT push to createdSessionIds — we're deleting it here.
    await createTestSession(sessionId);

    const id = store.store(sessionId, "cascade test", "body", 4);
    expect(id).not.toBeNull();
    expect(store.retrieve(sessionId, id!)).not.toBeNull();

    await deleteTestSession(sessionId);

    // After session deletion, the child row is gone (CASCADE).
    const rows = db
      .select()
      .from(truncatedContent)
      .where(eq(truncatedContent.id, id!))
      .all();
    expect(rows).toHaveLength(0);

    // And a retrieve() call also returns null.
    expect(store.retrieve(sessionId, id!)).toBeNull();
  });

  it("returns null when inserting with an unknown sessionId (FK violation)", () => {
    const unknownSessionId = `nonexistent-${Date.now()}`;
    const id = store.store(unknownSessionId, "orphan", "body", 4);
    expect(id).toBeNull();
  });

  it("clearSession removes every row for a session", async () => {
    const sessionId = uniqueSessionId("clear");
    createdSessionIds.push(sessionId);
    await createTestSession(sessionId);

    store.store(sessionId, "1", "one", 0);
    store.store(sessionId, "2", "two", 0);
    store.store(sessionId, "3", "three", 0);

    expect(store.list(sessionId)).toHaveLength(3);
    expect(store.sessionHasContent(sessionId)).toBe(true);

    store.clearSession(sessionId);

    expect(store.list(sessionId)).toHaveLength(0);
    expect(store.sessionHasContent(sessionId)).toBe(false);
  });

  it("list returns non-expired summaries only", async () => {
    const sessionId = uniqueSessionId("list");
    createdSessionIds.push(sessionId);
    await createTestSession(sessionId);

    store.store(sessionId, "alive-1", "x", 0, 10 * 60 * 1000);
    store.store(sessionId, "alive-2", "yy", 1, 10 * 60 * 1000);
    store.store(sessionId, "dead-1", "zzz", 2, 1);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const summaries = store.list(sessionId);
    expect(summaries).toHaveLength(2);
    const contexts = summaries.map((s) => s.context).sort();
    expect(contexts).toEqual(["alive-1", "alive-2"]);
    for (const s of summaries) {
      expect(s.id).toMatch(/^trunc_/);
      expect(typeof s.fullLength).toBe("number");
      expect(typeof s.truncatedLength).toBe("number");
    }
  });

  it("sessionHasContent returns false for a session with no entries", () => {
    const unknownSessionId = `empty-${Date.now()}`;
    expect(store.sessionHasContent(unknownSessionId)).toBe(false);
    expect(store.list(unknownSessionId)).toEqual([]);
  });
});
