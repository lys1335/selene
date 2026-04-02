import Database from "better-sqlite3";

/**
 * Initialize design gallery tables: design_components.
 */
export function initDesignGalleryTablesWith(sqlite: Database.Database): void {
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
}
