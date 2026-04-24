import { db } from "@/lib/db/sqlite-client";
import { designSnapshots } from "@/lib/db/schema/design-snapshots";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { PersistedDesignSnapshot } from "@/lib/design/workspace/persisted-snapshot-types";

// ---------------------------------------------------------------------------
// Persisted design snapshots module.
//
// Mirrors the style of `lib/design/gallery/queries.ts`:
//   - All functions user+session scoped.
//   - Reads never leak existence across users / sessions — mismatched scopes
//     return `null` (not a row-not-found error).
//   - Writes run inside `db.transaction()` for atomic "read-then-update"
//     semantics.
//
// The app-facing row shape (`PersistedDesignSnapshot`) is kept separate from
// the Zustand in-memory `DesignSnapshot` — see
// `lib/design/workspace/persisted-snapshot-types.ts` for the rationale.
// ---------------------------------------------------------------------------

/** Hard cap on `listSnapshots` rows so pathological queries stay bounded. */
export const SNAPSHOT_LIST_HARD_CAP = 100;

/** Handler-level maximum length for snapshot `name`. */
export const SNAPSHOT_NAME_MAX_LENGTH = 200;

/** Thrown by `createSnapshot` when the INSERT hits a constraint error. */
export class SnapshotCreateError extends Error {
  code = "SNAPSHOT_CREATE_FAILED" as const;
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SnapshotCreateError";
    this.cause = cause;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeParseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function toRow(row: typeof designSnapshots.$inferSelect): PersistedDesignSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    componentId: row.componentId,
    sourceCode: row.sourceCode,
    name: row.name ?? null,
    isPinned: Boolean(row.isPinned),
    metadata: safeParseMetadata(row.metadata ?? null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateSnapshotInput {
  id: string;
  userId: string;
  sessionId: string;
  componentId: string;
  sourceCode: string;
  name?: string | null;
  isPinned?: boolean;
}

/**
 * Insert a new persisted snapshot row. The `id` is supplied by the caller
 * (who owns UUID minting) so the row's identity is predictable before the
 * INSERT — matches the `generateId()` + `saveDesignComponentRecord` pattern
 * used by the gallery queries.
 *
 * Throws `SnapshotCreateError` (code `SNAPSHOT_CREATE_FAILED`) when the
 * INSERT fails for any reason (constraint violation, disk IO, etc.).
 */
export async function createSnapshot(
  input: CreateSnapshotInput,
): Promise<PersistedDesignSnapshot> {
  const ts = nowIso();
  try {
    const [inserted] = await db
      .insert(designSnapshots)
      .values({
        id: input.id,
        userId: input.userId,
        sessionId: input.sessionId,
        componentId: input.componentId,
        sourceCode: input.sourceCode,
        name: input.name ?? null,
        isPinned: input.isPinned ?? false,
        metadata: null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();
    return toRow(inserted);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to insert snapshot row.";
    throw new SnapshotCreateError(message, error);
  }
}

/**
 * Fetch a snapshot by id, scoped to (userId, sessionId). A row that exists
 * but is owned by another user OR another session returns `null` — the
 * function never leaks existence across scopes.
 */
export async function findSnapshotById(
  id: string,
  userId: string,
  sessionId: string,
): Promise<PersistedDesignSnapshot | null> {
  const row = await db.query.designSnapshots.findFirst({
    where: and(
      eq(designSnapshots.id, id),
      eq(designSnapshots.userId, userId),
      eq(designSnapshots.sessionId, sessionId),
    ),
  });
  return row ? toRow(row) : null;
}

export interface ListSnapshotsInput {
  userId: string;
  sessionId: string;
  isPinnedOnly?: boolean;
  componentId?: string;
  limit?: number;
}

/**
 * List snapshots for (userId, sessionId), ordered newest-first.
 *
 * `limit` is clamped to `SNAPSHOT_LIST_HARD_CAP` (100). Callers that request
 * above the cap receive the capped list — this function does NOT surface
 * truncation. The tool handler inspects the caller-supplied limit before
 * clamping and emits the `truncated` flag on the envelope.
 */
export async function listSnapshots(
  opts: ListSnapshotsInput,
): Promise<PersistedDesignSnapshot[]> {
  const conditions: SQL[] = [
    eq(designSnapshots.userId, opts.userId),
    eq(designSnapshots.sessionId, opts.sessionId),
  ];
  if (opts.componentId) {
    conditions.push(eq(designSnapshots.componentId, opts.componentId));
  }
  if (opts.isPinnedOnly) {
    conditions.push(eq(designSnapshots.isPinned, true));
  }

  const effectiveLimit = Math.max(
    1,
    Math.min(opts.limit ?? SNAPSHOT_LIST_HARD_CAP, SNAPSHOT_LIST_HARD_CAP),
  );

  const rows = await db
    .select()
    .from(designSnapshots)
    .where(and(...conditions))
    .orderBy(desc(designSnapshots.createdAt))
    .limit(effectiveLimit);

  return rows.map(toRow);
}

/**
 * Pin / unpin a snapshot, scoped to (userId, sessionId). Runs inside
 * `db.transaction()` so the is_pinned + updated_at mutation is atomic.
 *
 * Returns the updated row, or `null` when no row matches the full scope
 * (id + userId + sessionId) — never leaks existence for rows owned by
 * another user or another session.
 */
export async function pinSnapshot(
  id: string,
  userId: string,
  sessionId: string,
  isPinned: boolean,
): Promise<PersistedDesignSnapshot | null> {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(designSnapshots)
      .where(
        and(
          eq(designSnapshots.id, id),
          eq(designSnapshots.userId, userId),
          eq(designSnapshots.sessionId, sessionId),
        ),
      )
      .limit(1)
      .all();
    if (existing.length === 0) return null;

    const [updated] = tx
      .update(designSnapshots)
      .set({
        isPinned,
        updatedAt: nowIso(),
      })
      .where(
        and(
          eq(designSnapshots.id, id),
          eq(designSnapshots.userId, userId),
          eq(designSnapshots.sessionId, sessionId),
        ),
      )
      .returning()
      .all();

    return updated ? toRow(updated) : null;
  });
}

/**
 * Rename a snapshot, scoped to (userId, sessionId). Pass `null` to clear the
 * name. Returns the updated row or `null` when no row matches scope.
 *
 * Handler-level max-length enforcement (SNAPSHOT_NAME_MAX_LENGTH) lives in
 * the tool action — this function trusts its input so tests can reason
 * about DB state without going through the tool boundary.
 */
export async function renameSnapshot(
  id: string,
  userId: string,
  sessionId: string,
  name: string | null,
): Promise<PersistedDesignSnapshot | null> {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(designSnapshots)
      .where(
        and(
          eq(designSnapshots.id, id),
          eq(designSnapshots.userId, userId),
          eq(designSnapshots.sessionId, sessionId),
        ),
      )
      .limit(1)
      .all();
    if (existing.length === 0) return null;

    const [updated] = tx
      .update(designSnapshots)
      .set({
        name,
        updatedAt: nowIso(),
      })
      .where(
        and(
          eq(designSnapshots.id, id),
          eq(designSnapshots.userId, userId),
          eq(designSnapshots.sessionId, sessionId),
        ),
      )
      .returning()
      .all();

    return updated ? toRow(updated) : null;
  });
}

/**
 * Delete a snapshot, scoped to (userId, sessionId). Returns true when a row
 * was deleted, false when no row matched — so cross-scope attempts and
 * already-deleted ids return false instead of throwing.
 */
export async function deleteSnapshot(
  id: string,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const result = await db
    .delete(designSnapshots)
    .where(
      and(
        eq(designSnapshots.id, id),
        eq(designSnapshots.userId, userId),
        eq(designSnapshots.sessionId, sessionId),
      ),
    )
    .returning({ id: designSnapshots.id });

  // Touch `sql` so the import stays local to the module graph even if none
  // of the drizzle expressions above need it directly — keeps future raw-SQL
  // helpers aligned with the existing queries.ts convention.
  void sql;

  return result.length > 0;
}
