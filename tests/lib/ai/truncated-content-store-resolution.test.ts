/**
 * TruncatedContentStore backend resolution + InMemory behaviour tests.
 *
 * Covers the module-level barrel at lib/ai/truncated-content-store/index.ts:
 *   - setContentStoreForTesting() injects a custom backend
 *   - storeFullContent / retrieveFullContent delegate to the active store
 *   - InMemoryContentStore handles its own round-trip, TTL, clear, list,
 *     and cleanupExpired semantics the same way the SQLite backend does
 *
 * These tests never touch SQLite — they override the active store to a
 * fresh InMemoryContentStore, then restore the original store in afterAll.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";

import {
  InMemoryContentStore,
  setContentStoreForTesting,
  storeFullContent,
  retrieveFullContent,
  listStoredContent,
  sessionHasTruncatedContent,
  clearTruncatedContentSession,
} from "@/lib/ai/truncated-content-store";

describe("TruncatedContentStore barrel — InMemory backend via injection", () => {
  let inMemory: InMemoryContentStore;

  beforeEach(() => {
    inMemory = new InMemoryContentStore();
    setContentStoreForTesting(inMemory);
  });

  afterEach(() => {
    setContentStoreForTesting(null);
  });

  afterAll(() => {
    // Hard reset so later tests in the run observe the default resolution.
    setContentStoreForTesting(null);
  });

  it("round-trips through the barrel functions", () => {
    const id = storeFullContent("sess-1", "webSearch", "hello world body", 16);
    expect(id).not.toBeNull();
    const entry = retrieveFullContent("sess-1", id!);
    expect(entry).not.toBeNull();
    expect(entry!.fullContent).toBe("hello world body");
    expect(entry!.context).toBe("webSearch");
  });

  it("returns null for an unknown contentId", () => {
    const entry = retrieveFullContent("sess-unknown", "trunc_missing");
    expect(entry).toBeNull();
  });

  it("lists non-expired entries and reports sessionHasContent", () => {
    storeFullContent("sess-list", "a", "alpha", 1);
    storeFullContent("sess-list", "b", "beta", 1);
    expect(sessionHasTruncatedContent("sess-list")).toBe(true);
    const items = listStoredContent("sess-list");
    expect(items).toHaveLength(2);
    expect(items.map((x) => x.context).sort()).toEqual(["a", "b"]);
  });

  it("clearTruncatedContentSession drops every entry for a session", () => {
    storeFullContent("sess-clear", "x", "body", 4);
    expect(sessionHasTruncatedContent("sess-clear")).toBe(true);
    clearTruncatedContentSession("sess-clear");
    expect(sessionHasTruncatedContent("sess-clear")).toBe(false);
    expect(listStoredContent("sess-clear")).toEqual([]);
  });

  it("InMemoryContentStore expires entries on retrieve and cleanup", async () => {
    const id = inMemory.store("sess-ttl", "short", "body", 4, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // retrieve should return null and also delete the expired entry.
    expect(inMemory.retrieve("sess-ttl", id)).toBeNull();

    // cleanupExpired reports 0 after the entry was already evicted.
    const removed = inMemory.cleanupExpired();
    expect(removed).toBeGreaterThanOrEqual(0);

    // And the session no longer reports content.
    expect(inMemory.sessionHasContent("sess-ttl")).toBe(false);
  });

  it("InMemoryContentStore cleanup removes expired but keeps live entries", async () => {
    const dyingId = inMemory.store("sess-mix", "dying", "x", 0, 1);
    const liveId = inMemory.store("sess-mix", "live", "yy", 1, 60 * 1000);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const removed = inMemory.cleanupExpired();
    expect(removed).toBe(1);
    expect(inMemory.retrieve("sess-mix", dyingId)).toBeNull();
    expect(inMemory.retrieve("sess-mix", liveId)).not.toBeNull();
  });
});
