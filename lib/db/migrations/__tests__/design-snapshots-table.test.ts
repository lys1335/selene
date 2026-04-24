/**
 * Coverage for `initDesignSnapshotsTableWith` (Sprint 3 W3.1).
 *
 * Runs the migration end-to-end against an in-memory better-sqlite3 DB so
 * the CREATE TABLE + CREATE INDEX statements exercise the real SQL. The
 * `design_components` parent table is initialized first via
 * `initDesignGalleryTablesWith` (which the composite migration wires in
 * before this one) because `design_snapshots` holds a FK with ON DELETE
 * CASCADE into it.
 *
 * Invariants under test:
 *   1. The migration is idempotent — a second invocation is a no-op that
 *      doesn't drop / recreate rows.
 *   2. The table has exactly the expected column shape.
 *   3. All three declared indexes exist after the migration runs.
 *   4. Deleting the parent `design_components` row cascades the
 *      `design_snapshots` rows that reference it.
 */
import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { initDesignGalleryTablesWith } from "../design-gallery-tables";
import { initDesignSnapshotsTableWith } from "../design-snapshots-table";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Minimal parent tables referenced by the gallery FKs.
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
    INSERT INTO characters (id) VALUES ('char-a');
    INSERT INTO sessions (id) VALUES ('sess-a');
  `);

  // design_components must exist before design_snapshots (FK).
  initDesignGalleryTablesWith(db);
  return db;
}

describe("initDesignSnapshotsTableWith", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    initDesignSnapshotsTableWith(db);
  });

  it("creates the design_snapshots table with the expected columns", () => {
    const cols = db
      .prepare("PRAGMA table_info(design_snapshots)")
      .all() as { name: string; type: string; notnull: number; dflt_value: string | null }[];

    const byName = new Map(cols.map((c) => [c.name, c]));
    const expected = [
      "id",
      "user_id",
      "session_id",
      "component_id",
      "source_code",
      "name",
      "is_pinned",
      "metadata",
      "created_at",
      "updated_at",
    ];
    expect([...byName.keys()].sort()).toEqual(expected.slice().sort());

    // Spot-check critical shape: is_pinned INTEGER NOT NULL DEFAULT 0,
    // name nullable, metadata nullable.
    expect(byName.get("is_pinned")!.notnull).toBe(1);
    expect(byName.get("is_pinned")!.type.toUpperCase()).toContain("INT");
    expect(byName.get("name")!.notnull).toBe(0);
    expect(byName.get("metadata")!.notnull).toBe(0);
    expect(byName.get("source_code")!.notnull).toBe(1);
    expect(byName.get("component_id")!.notnull).toBe(1);
  });

  it("creates all three declared indexes", () => {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND tbl_name = 'design_snapshots'
             AND name NOT LIKE 'sqlite_autoindex_%'`,
      )
      .all() as { name: string }[];

    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(
      [
        "idx_design_snapshots_component",
        "idx_design_snapshots_user_session_created",
        "idx_design_snapshots_user_session_pinned",
      ].sort(),
    );
  });

  it("is idempotent — running twice is a no-op", () => {
    // Seed a parent component then a child snapshot.
    db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code
      ) VALUES ('comp-1', 'user-a', 'sess-a', 'hero', 'p', 'c')`,
    ).run();
    db.prepare(
      `INSERT INTO design_snapshots (
        id, user_id, session_id, component_id, source_code
      ) VALUES ('snap-1', 'user-a', 'sess-a', 'comp-1', 'const A = 1;')`,
    ).run();

    expect(() => initDesignSnapshotsTableWith(db)).not.toThrow();

    const rows = db
      .prepare(`SELECT id FROM design_snapshots WHERE id = 'snap-1'`)
      .all();
    expect(rows).toHaveLength(1);
  });

  it("cascades deletes from design_components to design_snapshots", () => {
    db.prepare(
      `INSERT INTO design_components (
        id, user_id, session_id, name, prompt, code
      ) VALUES ('comp-1', 'user-a', 'sess-a', 'hero', 'p', 'c')`,
    ).run();
    db.prepare(
      `INSERT INTO design_snapshots (
        id, user_id, session_id, component_id, source_code
      ) VALUES (?, 'user-a', 'sess-a', 'comp-1', 's')`,
    ).run("snap-1");
    db.prepare(
      `INSERT INTO design_snapshots (
        id, user_id, session_id, component_id, source_code
      ) VALUES (?, 'user-a', 'sess-a', 'comp-1', 's')`,
    ).run("snap-2");

    db.prepare(`DELETE FROM design_components WHERE id = 'comp-1'`).run();

    const remaining = db
      .prepare(`SELECT id FROM design_snapshots`)
      .all();
    expect(remaining).toHaveLength(0);
  });
});
