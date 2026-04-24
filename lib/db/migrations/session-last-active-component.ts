import Database from "better-sqlite3";

/**
 * Sprint 4 W4.3 — persist the design workspace's "currently focused"
 * component across session restart.
 *
 * Adds a nullable `last_active_component_id` column to `sessions`. The
 * column acts as a pointer: on workspace rehydration the client reads
 * this value and calls `setActiveComponent` with it, so the user re-opens
 * the session on the exact component they were last editing.
 *
 * Design notes:
 *   - The `sessions` table is the single session lifecycle table
 *     (see `lib/db/sqlite-schema-base.ts`). There is no separate
 *     "design session" row; `design_components.session_id` already FKs
 *     here. Putting the pointer on `sessions` keeps it colocated with
 *     other per-session metadata (`last_message_at`, `last_ordering_index`).
 *   - Column is nullable — a session with no design activity has a NULL
 *     pointer, which the client treats as "no selection".
 *   - FK is declared `ON DELETE SET NULL`: if the pointed-at component is
 *     deleted from the gallery the pointer auto-nulls instead of
 *     orphaning. Reads still guard against stale IDs (the pointed row may
 *     exist but be out-of-scope for the requesting user) — that check is
 *     enforced at the query layer, not the DB layer.
 *   - The migration is idempotent. Uses the `PRAGMA table_info` guard
 *     pattern from `design-gallery-tables.ts` so a second run is a no-op.
 *
 * MUST run after `initDesignGalleryTablesWith` because the FK references
 * `design_components(id)`. Wiring lives in `sqlite-migrations.ts`.
 */
export function initSessionLastActiveComponentWith(
  sqlite: Database.Database,
): void {
  const cols = sqlite
    .prepare("PRAGMA table_info(sessions)")
    .all() as { name: string }[];

  const hasLastActiveComponentId = cols.some(
    (c) => c.name === "last_active_component_id",
  );

  if (!hasLastActiveComponentId) {
    // SQLite's ALTER TABLE can add a FK-carrying column when the referenced
    // table already exists. `design_components` is created by
    // `initDesignGalleryTablesWith` which is called earlier in the migration
    // sequence (see `sqlite-migrations.ts`).
    sqlite.exec(`
      ALTER TABLE sessions
        ADD COLUMN last_active_component_id TEXT
          REFERENCES design_components(id) ON DELETE SET NULL
    `);
  }
}
