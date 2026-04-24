/**
 * Coverage for `initDesignGalleryTablesWith` (Sprint 2 Rev-B — BA-2).
 *
 * Uses an in-memory better-sqlite3 database so the migration runs
 * end-to-end without depending on the real sqlite client. We seed the
 * `users` table with the same minimal columns `initDesignGalleryTablesWith`
 * references via foreign keys so the CREATE TABLE statements succeed.
 *
 * Invariants under test:
 *
 *   1. The migration is idempotent — running it twice leaves the schema
 *      identical (no "table already exists" errors, no duplicated rows).
 *   2. The new partial unique index
 *      `idx_design_components_source_path_unique` rejects a second INSERT
 *      with the same `(user_id, session_id, json_extract(metadata, '$.sourcePath'))`
 *      triple with `SQLITE_CONSTRAINT_UNIQUE`.
 *   3. The partial index does NOT constrain rows where `metadata` is null
 *      or where `metadata.sourcePath` is missing — generated / patched
 *      designs keep the old behavior.
 */
import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { initDesignGalleryTablesWith } from "../design-gallery-tables";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Minimal `users` + `characters` + `sessions` tables so the FKs the
  // migration declares can resolve. Only the columns the migration
  // references are included — anything else would add noise without
  // changing the test outcome.
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE characters (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY
    );
    INSERT INTO users (id) VALUES ('user-a');
    INSERT INTO users (id) VALUES ('user-b');
    INSERT INTO characters (id) VALUES ('char-a');
    INSERT INTO sessions (id) VALUES ('sess-a');
    INSERT INTO sessions (id) VALUES ('sess-b');
  `);

  return db;
}

describe("initDesignGalleryTablesWith", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    initDesignGalleryTablesWith(db);
  });

  it("is idempotent — running twice is a no-op", () => {
    // Running the migration a second time must not throw and must not
    // drop / duplicate any existing rows.
    db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code, metadata
      ) VALUES (
        'row-1', 'user-a', 'sess-a', 'hero', 'prompt', 'code',
        json_object('sourcePath', 'components/hero.tsx')
      )`,
    ).run();

    expect(() => initDesignGalleryTablesWith(db)).not.toThrow();

    const rows = db
      .prepare(`SELECT id FROM design_components WHERE id = 'row-1'`)
      .all();
    expect(rows).toHaveLength(1);
  });

  it("creates the partial unique index on (user_id, session_id, sourcePath)", () => {
    const indexRow = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'index'
            AND name = 'idx_design_components_source_path_unique'`,
      )
      .get() as { name: string } | undefined;

    expect(indexRow?.name).toBe("idx_design_components_source_path_unique");
  });

  it("rejects a second INSERT with the same (user_id, session_id, sourcePath) triple", () => {
    const insert = db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    insert.run(
      "row-1",
      "user-a",
      "sess-a",
      "hero",
      "prompt",
      "code",
      JSON.stringify({ sourcePath: "components/hero.tsx" }),
    );

    let caughtCode: string | undefined;
    try {
      insert.run(
        "row-2",
        "user-a",
        "sess-a",
        "hero-dup",
        "prompt",
        "code",
        JSON.stringify({ sourcePath: "components/hero.tsx" }),
      );
    } catch (error) {
      caughtCode = (error as { code?: string }).code;
    }
    expect(caughtCode).toMatch(/SQLITE_CONSTRAINT/);
  });

  it("does NOT block rows with NULL metadata or missing sourcePath", () => {
    const insert = db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // Two rows with NULL metadata — generated designs never hit the
    // partial index because the WHERE clause excludes them.
    expect(() =>
      insert.run("row-1", "user-a", "sess-a", "gen-1", "p", "c", null),
    ).not.toThrow();
    expect(() =>
      insert.run("row-2", "user-a", "sess-a", "gen-2", "p", "c", null),
    ).not.toThrow();

    // Metadata without sourcePath — also excluded.
    expect(() =>
      insert.run(
        "row-3",
        "user-a",
        "sess-a",
        "gen-3",
        "p",
        "c",
        JSON.stringify({ otherField: "x" }),
      ),
    ).not.toThrow();
    expect(() =>
      insert.run(
        "row-4",
        "user-a",
        "sess-a",
        "gen-4",
        "p",
        "c",
        JSON.stringify({ otherField: "y" }),
      ),
    ).not.toThrow();
  });

  it("allows the same sourcePath across different sessions or users", () => {
    const insert = db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // Different sessions — index key differs, so both inserts succeed.
    insert.run(
      "row-1",
      "user-a",
      "sess-a",
      "hero",
      "p",
      "c",
      JSON.stringify({ sourcePath: "components/hero.tsx" }),
    );
    expect(() =>
      insert.run(
        "row-2",
        "user-a",
        "sess-b",
        "hero",
        "p",
        "c",
        JSON.stringify({ sourcePath: "components/hero.tsx" }),
      ),
    ).not.toThrow();

    // Different users — same as above.
    expect(() =>
      insert.run(
        "row-3",
        "user-b",
        "sess-a",
        "hero",
        "p",
        "c",
        JSON.stringify({ sourcePath: "components/hero.tsx" }),
      ),
    ).not.toThrow();
  });
});
