/**
 * SQLite-backed ContentStore implementation.
 *
 * Persists the full primary text of each oversized tool result to the
 * `truncated_content` table so contentIds survive Electron restarts,
 * crash-recovery, and cross-instance reads.
 *
 * Behavior notes:
 *  - `better-sqlite3` is synchronous — every method here is a straight
 *    prepared-statement run with no async boundary.
 *  - TTL-bounded via `expires_at`. `cleanupExpired()` is called on a
 *    15-minute interval (see ./index.ts).
 *  - `onDelete: CASCADE` on the FK to `sessions.id` keeps rows tidy
 *    when sessions are deleted.
 *  - Store failures (disk full, locked DB, FK violation because the
 *    session row doesn't exist) return `null` from `store()` — callers
 *    are expected to handle that with an inline-preview fallback.
 */

import { nanoid } from "nanoid";
import { and, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/sqlite-client";
import { truncatedContent } from "@/lib/db/sqlite-schema-base";

import {
  DEFAULT_TTL_MS,
  type ContentStore,
  type StoredContentSummary,
  type TruncatedContentEntry,
} from "./types";

// Log storage failures at most once per 5 minutes to avoid log spam
// when the DB is unavailable.
const STORAGE_FAILURE_LOG_COOLDOWN_MS = 5 * 60 * 1000;
let lastStorageFailureLogAt = 0;

function warnStorageFailure(op: string, err: unknown): void {
  const now = Date.now();
  if (now - lastStorageFailureLogAt < STORAGE_FAILURE_LOG_COOLDOWN_MS) return;
  lastStorageFailureLogAt = now;
  console.warn(
    `[TruncatedContentStore:sqlite] ${op} failed (suppressing further errors for 5min): ${String(err)}`,
  );
}

export class SqliteContentStore implements ContentStore {
  store(
    sessionId: string,
    context: string,
    fullContent: string,
    truncatedLength: number,
    ttlMs: number = DEFAULT_TTL_MS,
  ): string | null {
    const id = `trunc_${nanoid(8)}`;
    const storedAt = Date.now();
    const expiresAt = storedAt + ttlMs;

    try {
      db.insert(truncatedContent)
        .values({
          id,
          sessionId,
          context,
          fullContent,
          fullLength: fullContent.length,
          truncatedLength,
          storedAt,
          expiresAt,
        })
        .run();
      return id;
    } catch (err) {
      warnStorageFailure("store", err);
      return null;
    }
  }

  retrieve(sessionId: string, contentId: string): TruncatedContentEntry | null {
    try {
      const row = db
        .select()
        .from(truncatedContent)
        .where(
          and(
            eq(truncatedContent.id, contentId),
            eq(truncatedContent.sessionId, sessionId),
          ),
        )
        .get();

      if (!row) return null;

      // Honour TTL even if the cleanup sweep hasn't run yet.
      if (row.expiresAt < Date.now()) {
        try {
          db.delete(truncatedContent)
            .where(eq(truncatedContent.id, contentId))
            .run();
        } catch {
          /* best-effort cleanup */
        }
        return null;
      }

      return {
        id: row.id,
        sessionId: row.sessionId,
        context: row.context,
        fullContent: row.fullContent,
        fullLength: row.fullLength,
        truncatedLength: row.truncatedLength,
        storedAt: new Date(row.storedAt),
        expiresAt: new Date(row.expiresAt),
      };
    } catch (err) {
      warnStorageFailure("retrieve", err);
      return null;
    }
  }

  list(sessionId: string): StoredContentSummary[] {
    try {
      const now = Date.now();
      const rows = db
        .select({
          id: truncatedContent.id,
          context: truncatedContent.context,
          fullLength: truncatedContent.fullLength,
          truncatedLength: truncatedContent.truncatedLength,
        })
        .from(truncatedContent)
        .where(
          and(
            eq(truncatedContent.sessionId, sessionId),
            gt(truncatedContent.expiresAt, now),
          ),
        )
        .all();
      return rows;
    } catch (err) {
      warnStorageFailure("list", err);
      return [];
    }
  }

  sessionHasContent(sessionId: string): boolean {
    try {
      const now = Date.now();
      const row = db
        .select({ id: truncatedContent.id })
        .from(truncatedContent)
        .where(
          and(
            eq(truncatedContent.sessionId, sessionId),
            gt(truncatedContent.expiresAt, now),
          ),
        )
        .limit(1)
        .get();
      return row != null;
    } catch (err) {
      warnStorageFailure("sessionHasContent", err);
      return false;
    }
  }

  clearSession(sessionId: string): void {
    try {
      db.delete(truncatedContent)
        .where(eq(truncatedContent.sessionId, sessionId))
        .run();
    } catch (err) {
      warnStorageFailure("clearSession", err);
    }
  }

  cleanupExpired(): number {
    try {
      const now = Date.now();
      const result = db
        .delete(truncatedContent)
        .where(lte(truncatedContent.expiresAt, now))
        .run();
      // better-sqlite3 returns { changes, lastInsertRowid } — drizzle wraps it.
      const changes =
        (result as unknown as { changes?: number }).changes ?? 0;
      if (changes > 0) {
        console.log(
          `[TruncatedContentStore:sqlite] Cleanup: removed ${changes} expired rows`,
        );
      }
      return changes;
    } catch (err) {
      warnStorageFailure("cleanupExpired", err);
      return 0;
    }
  }
}

// Silence unused-import warning when `sql` ends up not needed at call sites.
void sql;
