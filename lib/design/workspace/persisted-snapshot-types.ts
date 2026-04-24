/**
 * PersistedDesignSnapshot — a DB-backed, explicitly-kept iteration of a design
 * component's source code. Rows live in the `design_snapshots` table (see
 * `lib/db/migrations/design-snapshots-table.ts`) and represent snapshots the
 * user or agent deliberately wants to keep around: named iterations, pinned
 * checkpoints, or saves that will later be used for diffing / restoring.
 *
 * This type is intentionally kept SEPARATE from the in-memory `DesignSnapshot`
 * declared in `./types.ts`. That one is the transient Zustand undo-history
 * entry: lightweight, session-scoped, ephemeral, created by
 * `takeSnapshot` / restored by `restoreSnapshot` on the client. This one is
 * durable: it carries a `userId`, `sessionId`, `isPinned`, `name`, and
 * `metadata` bag for future extensions. Do not conflate the two.
 *
 * The shape mirrors the row returned by `lib/design/gallery/snapshot-queries`.
 * `isPinned` is surfaced as a real boolean (not the SQLite 0/1 integer). The
 * `metadata` bag is parsed JSON when present; `null` when unset or
 * unparseable.
 */
export interface PersistedDesignSnapshot {
  /** Client-generated UUID — the row's primary key. */
  id: string;
  /** Owning user (FK semantics, no constraint — matches existing convention). */
  userId: string;
  /** Owning chat session (FK semantics, no constraint). */
  sessionId: string;
  /** Component the snapshot captured (FK to design_components with ON DELETE CASCADE). */
  componentId: string;
  /** The TSX source code captured at snapshot time. */
  sourceCode: string;
  /** User/agent-chosen label (<= 200 chars). `null` when unnamed. */
  name: string | null;
  /** True when the snapshot is pinned. Stored as 0/1 on disk, surfaced as boolean. */
  isPinned: boolean;
  /**
   * Open-ended JSON bag reserved for future snapshot metadata (diff anchors,
   * thumbnail refs, etc.). `null` when unset. Not written by any action in
   * this sprint — future actions can persist structured values here without
   * another migration.
   */
  metadata: Record<string, unknown> | null;
  /** ISO timestamp (row creation). */
  createdAt: string;
  /** ISO timestamp (last pin / rename). */
  updatedAt: string;
}
