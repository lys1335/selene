import Database from "better-sqlite3";

/**
 * Initialize design gallery tables: design_projects, design_components.
 */
export function initDesignGalleryTablesWith(sqlite: Database.Database): void {
  // -- design_projects must be created before design_components (FK dependency)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS design_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      cover_image_url TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      is_archived INTEGER NOT NULL DEFAULT 0,
      component_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_projects_user
      ON design_projects (user_id)
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_projects_updated
      ON design_projects (user_id, updated_at)
  `);

  // -- design_components
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS design_components (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      prompt TEXT NOT NULL,
      code TEXT NOT NULL,
      framework TEXT NOT NULL DEFAULT 'html-css',
      category TEXT NOT NULL DEFAULT 'general',
      tags TEXT NOT NULL DEFAULT '[]',
      style_tags TEXT NOT NULL DEFAULT '[]',
      preview_path TEXT,
      mode TEXT NOT NULL DEFAULT 'html',
      style TEXT NOT NULL DEFAULT 'default',
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_components_user
      ON design_components (user_id)
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_components_category
      ON design_components (user_id, category)
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_components_updated
      ON design_components (user_id, updated_at)
  `);

  // -- Add project_id column to existing design_components tables (safe migration)
  const cols = sqlite
    .prepare("PRAGMA table_info(design_components)")
    .all() as { name: string }[];
  const hasProjectId = cols.some((c) => c.name === "project_id");
  if (!hasProjectId) {
    sqlite.exec(`
      ALTER TABLE design_components
        ADD COLUMN project_id TEXT REFERENCES design_projects(id) ON DELETE SET NULL
    `);
  }

  // -- Sprint 2 W2.1: Add `metadata` JSON column for import-action metadata
  // (sourcePath, importedAt, …). Uses the same additive + idempotent pattern
  // as project_id above. Nullable so existing rows remain untouched.
  const hasMetadata = cols.some((c) => c.name === "metadata");
  if (!hasMetadata) {
    sqlite.exec(`
      ALTER TABLE design_components
        ADD COLUMN metadata TEXT
    `);
  }

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_design_components_project
      ON design_components (project_id)
  `);

  // -- Sprint 2 Rev-B (BA-2, BA-warn-6) — import idempotency.
  //
  // Enforces at the DB level that a given (user_id, session_id, sourcePath)
  // triple can only have ONE non-null row. Previously the import action
  // relied on a TOCTOU find-then-insert that allowed racing duplicates
  // when the same tool call fired twice concurrently.
  //
  // The index is PARTIAL so it only applies to rows that actually carry
  // `metadata.sourcePath` — generated / patched designs keep
  // `metadata = NULL` and are unaffected. `CREATE INDEX IF NOT EXISTS`
  // makes the migration idempotent: the second run is a no-op.
  //
  // NOTE: SQLite partial indexes use `WHERE` inline with CREATE. The
  // `json_extract(metadata, '$.sourcePath')` expression matches the
  // lookup in `findDesignComponentBySourcePath` (queries.ts) so the
  // planner uses the index for both the uniqueness check and the read.
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_components_source_path_unique
      ON design_components (user_id, session_id, json_extract(metadata, '$.sourcePath'))
      WHERE metadata IS NOT NULL
        AND json_extract(metadata, '$.sourcePath') IS NOT NULL
  `);
}
