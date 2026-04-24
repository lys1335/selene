import Database from "better-sqlite3";

/**
 * Initialize the `design_snapshots` table.
 *
 * Rows here represent iterations of a design component the user or agent has
 * explicitly kept (named, pinned, or saved for diffing/later). This is a
 * separate concept from the transient Zustand undo history — the in-memory
 * DesignSnapshot (lib/design/workspace/types.ts) stays untouched.
 *
 * The migration follows the same idempotent pattern established by
 * `design-gallery-tables.ts`:
 *   - `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` for the
 *     initial schema.
 *   - `PRAGMA table_info(...)` guards for any future additive column migrations
 *     (no such columns in this first revision — the pattern is documented here
 *     so subsequent additions stay safe to re-run).
 *
 * Foreign-key semantics for `user_id` / `session_id` match the existing
 * convention: no FK constraint (the tables exist in a separate lifecycle),
 * just scoping columns used by every query. `component_id` DOES carry a real
 * FK with ON DELETE CASCADE so snapshots are swept when their parent
 * component is deleted.
 */
export function initDesignSnapshotsTableWith(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS design_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      component_id TEXT NOT NULL REFERENCES design_components(id) ON DELETE CASCADE,
      source_code TEXT NOT NULL,
      name TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_snapshots_user_session_created
      ON design_snapshots (user_id, session_id, created_at DESC)
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_snapshots_component
      ON design_snapshots (component_id)
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_snapshots_user_session_pinned
      ON design_snapshots (user_id, session_id, is_pinned)
  `);

  // Idempotency placeholder — identical to the pattern in
  // design-gallery-tables.ts:86-95. No additive columns in this first
  // revision; the `PRAGMA table_info` lookup is kept so future additions
  // can follow the established shape.
  const cols = sqlite
    .prepare("PRAGMA table_info(design_snapshots)")
    .all() as { name: string }[];
  // Touch the lookup so future `ALTER TABLE` diffs against this list stay
  // mechanical (mirrors design-gallery-tables.ts).
  void cols;
}
