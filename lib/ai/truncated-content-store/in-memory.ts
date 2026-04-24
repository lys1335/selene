/**
 * In-memory ContentStore implementation.
 *
 * Historical default — now preserved as a fallback (for tests, non-DB
 * environments, and for use when SQLite writes throw). Behavior is a
 * byte-for-byte preservation of the original `truncated-content-store.ts`
 * module, minus the per-session cap (TTL does the bounding per product
 * decision).
 */

import { nanoid } from "nanoid";

import {
  DEFAULT_TTL_MS,
  type ContentStore,
  type StoredContentSummary,
  type TruncatedContentEntry,
} from "./types";

interface InMemorySession {
  sessionId: string;
  entries: Map<string, TruncatedContentEntry>;
  createdAt: Date;
  lastAccessedAt: Date;
}

export class InMemoryContentStore implements ContentStore {
  private sessions = new Map<string, InMemorySession>();

  private getOrCreate(sessionId: string): InMemorySession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        entries: new Map(),
        createdAt: new Date(),
        lastAccessedAt: new Date(),
      };
      this.sessions.set(sessionId, session);
      console.log(`[TruncatedContentStore:memory] Created session: ${sessionId}`);
    }
    session.lastAccessedAt = new Date();
    return session;
  }

  store(
    sessionId: string,
    context: string,
    fullContent: string,
    truncatedLength: number,
    ttlMs: number = DEFAULT_TTL_MS,
  ): string {
    const session = this.getOrCreate(sessionId);
    const id = `trunc_${nanoid(8)}`;

    const entry: TruncatedContentEntry = {
      id,
      sessionId,
      context,
      fullContent,
      fullLength: fullContent.length,
      truncatedLength,
      storedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
    };

    session.entries.set(id, entry);
    console.log(
      `[TruncatedContentStore:memory] Stored ${id}: ${fullContent.length} chars (truncated to ${truncatedLength})`,
    );
    return id;
  }

  retrieve(sessionId: string, contentId: string): TruncatedContentEntry | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const entry = session.entries.get(contentId);
    if (!entry) return null;

    if (entry.expiresAt.getTime() < Date.now()) {
      session.entries.delete(contentId);
      return null;
    }
    return entry;
  }

  list(sessionId: string): StoredContentSummary[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const now = Date.now();
    const results: StoredContentSummary[] = [];
    for (const entry of session.entries.values()) {
      if (entry.expiresAt.getTime() > now) {
        results.push({
          id: entry.id,
          context: entry.context,
          fullLength: entry.fullLength,
          truncatedLength: entry.truncatedLength,
        });
      }
    }
    return results;
  }

  sessionHasContent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    const now = Date.now();
    for (const entry of session.entries.values()) {
      if (entry.expiresAt.getTime() > now) return true;
    }
    return false;
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanupExpired(): number {
    const now = Date.now();
    let totalCleaned = 0;
    const sessionsToDelete: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      for (const [entryId, entry] of session.entries) {
        if (entry.expiresAt.getTime() <= now) {
          session.entries.delete(entryId);
          totalCleaned++;
        }
      }
      if (session.entries.size === 0) {
        sessionsToDelete.push(sessionId);
      }
    }
    for (const sessionId of sessionsToDelete) {
      this.sessions.delete(sessionId);
    }
    if (totalCleaned > 0 || sessionsToDelete.length > 0) {
      console.log(
        `[TruncatedContentStore:memory] Cleanup: removed ${totalCleaned} entries, ${sessionsToDelete.length} sessions`,
      );
    }
    return totalCleaned;
  }
}
