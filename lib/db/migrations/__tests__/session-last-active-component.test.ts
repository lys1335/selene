/**
 * Coverage for `initSessionLastActiveComponentWith` (Sprint 4 W4.3).
 *
 * Uses an in-memory better-sqlite3 database so the migration runs
 * end-to-end against real SQL without depending on the developer's DB.
 *
 * Invariants under test:
 *   1. A freshly-migrated `sessions` table gains a nullable
 *      `last_active_component_id` column.
 *   2. The migration is idempotent — running twice leaves the schema
 *      identical, no "duplicate column" errors, and no row loss.
 *   3. The declared FK to `design_components(id)` fires ON DELETE SET NULL
 *      when the referenced component is deleted (so stale pointers self-
 *      heal at the DB layer).
 *   4. Inserting a pointer that does NOT reference an existing
 *      `design_components` row is rejected by the FK constraint — the DB
 *      layer refuses to persist an unconditionally bogus pointer.
 */
import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { initDesignGalleryTablesWith } from "../design-gallery-tables";
import { initSessionLastActiveComponentWith } from "../session-last-active-component";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Minimal parent tables referenced by the gallery FKs, plus a sessions
  // table shape-compatible with the real migration: `sessions.user_id`
  // references `users(id)` and the table holds rows keyed by `id`. The
  // columns the production `sessions` table carries beyond these aren't
  // touched by this migration so they're omitted.
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE characters (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      updated_at TEXT
    );
    INSERT INTO users (id) VALUES ('user-a');
    INSERT INTO sessions (id, user_id, updated_at) VALUES ('sess-a', 'user-a', '2024-01-01');
  `);

  // design_components must exist before we can add the FK-carrying column
  // to sessions.
  initDesignGalleryTablesWith(db);
  return db;
}

describe("initSessionLastActiveComponentWith", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    initSessionLastActiveComponentWith(db);
  });

  it("adds a nullable `last_active_component_id` column to `sessions`", () => {
    const cols = db
      .prepare("PRAGMA table_info(sessions)")
      .all() as { name: string; type: string; notnull: number; dflt_value: string | null }[];

    const col = cols.find((c) => c.name === "last_active_component_id");
    expect(col).toBeDefined();
    // TEXT column, nullable, no default.
    expect(col!.type.toUpperCase()).toBe("TEXT");
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value).toBeNull();
  });

  it("is idempotent — running twice is a no-op", () => {
    // Second invocation must not throw ("duplicate column name") and must
    // not disturb existing rows.
    expect(() => initSessionLastActiveComponentWith(db)).not.toThrow();

    const rows = db
      .prepare(`SELECT id FROM sessions WHERE id = 'sess-a'`)
      .all();
    expect(rows).toHaveLength(1);

    // Column count still shows exactly one entry.
    const cols = db
      .prepare("PRAGMA table_info(sessions)")
      .all() as { name: string }[];
    const hits = cols.filter((c) => c.name === "last_active_component_id");
    expect(hits).toHaveLength(1);
  });

  it("ON DELETE SET NULL clears the pointer when the referenced component is deleted", () => {
    db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code
      ) VALUES ('comp-1', 'user-a', 'sess-a', 'hero', 'p', 'c')`,
    ).run();

    db.prepare(
      `UPDATE sessions SET last_active_component_id = 'comp-1' WHERE id = 'sess-a'`,
    ).run();

    const before = db
      .prepare(`SELECT last_active_component_id FROM sessions WHERE id = 'sess-a'`)
      .get() as { last_active_component_id: string | null };
    expect(before.last_active_component_id).toBe("comp-1");

    db.prepare(`DELETE FROM design_components WHERE id = 'comp-1'`).run();

    const after = db
      .prepare(`SELECT last_active_component_id FROM sessions WHERE id = 'sess-a'`)
      .get() as { last_active_component_id: string | null };
    expect(after.last_active_component_id).toBeNull();
  });

  it("rejects a pointer that doesn't match any design_components row", () => {
    let caughtCode: string | undefined;
    try {
      db.prepare(
        `UPDATE sessions SET last_active_component_id = 'does-not-exist' WHERE id = 'sess-a'`,
      ).run();
    } catch (error) {
      caughtCode = (error as { code?: string }).code;
    }
    expect(caughtCode).toMatch(/SQLITE_CONSTRAINT/);
  });
});
