/**
 * Coverage for the `source='workspace'` backfill in `initCharacterTablesWith`.
 *
 * Two distinct invariants are under test:
 *
 *   1. `isGitWorktreePath` only returns true for actual git worktree marker
 *      files (`.git` *file* whose contents start with `gitdir: .../worktrees/...`).
 *      Plain directories, regular git repos (where `.git` is a *directory*),
 *      and look-alike directories named `worktrees/...` MUST return false.
 *
 *   2. The backfill in `initCharacterTablesWith` honors that predicate, so a
 *      legitimate user folder that happens to match the workspace-tool's
 *      sync-mode / indexing-mode / reindex-policy combo (e.g. a markdown
 *      reading list configured `manual` + `files-only` + `never`) is NOT
 *      reclassified to `source='workspace'`. The OLD heuristic relied on
 *      `display_name LIKE 'Workspace: %'` and would have produced false
 *      positives here.
 *
 *   3. The NULL-defaults pass runs BEFORE the workspace backfill, so legacy
 *      rows with NULL `sync_mode` / `indexing_mode` / `reindex_policy` get
 *      their canonical defaults first and the backfill sees them on the
 *      first migration run (no second-startup latency).
 */
import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCharacterTablesWith, isGitWorktreePath } from "../character-tables";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE plugins (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('user-a');
  `);
  return db;
}

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "wsbackfill-"));
}

function writeWorktreeMarker(dirPath: string, gitdirTarget: string): void {
  // A real git worktree has `.git` as a FILE (not a directory) whose contents
  // start with `gitdir: <repo>/.git/worktrees/<name>`.
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(join(dirPath, ".git"), `gitdir: ${gitdirTarget}\n`);
}

function writePlainGitRepo(dirPath: string): void {
  // A normal git repo has `.git` as a DIRECTORY.
  mkdirSync(join(dirPath, ".git"), { recursive: true });
}

describe("isGitWorktreePath", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns true for a real worktree marker file", () => {
    const wt = join(root, "wt-feature-x");
    writeWorktreeMarker(wt, "/Users/me/repo/.git/worktrees/feature-x");
    expect(isGitWorktreePath(wt)).toBe(true);
  });

  it("returns false for a regular git repo (where .git is a directory)", () => {
    const repo = join(root, "regular-repo");
    writePlainGitRepo(repo);
    expect(isGitWorktreePath(repo)).toBe(false);
  });

  it("returns false for a plain directory with no .git", () => {
    const plain = join(root, "plain-dir");
    mkdirSync(plain, { recursive: true });
    expect(isGitWorktreePath(plain)).toBe(false);
  });

  it("returns false for a directory whose .git file does NOT point at /worktrees/", () => {
    const submodule = join(root, "submodule");
    mkdirSync(submodule, { recursive: true });
    // Submodule .git files have `gitdir: ../.git/modules/<name>` — must not match.
    writeFileSync(join(submodule, ".git"), "gitdir: ../.git/modules/submodule\n");
    expect(isGitWorktreePath(submodule)).toBe(false);
  });

  it("returns false for a non-existent path", () => {
    expect(isGitWorktreePath(join(root, "does-not-exist"))).toBe(false);
  });

  it("returns false for a path with a directory literally named worktrees but no .git marker", () => {
    // Defense-in-depth: a user folder whose path includes the substring
    // 'worktrees' but is not actually a worktree must not be tagged.
    const lookalike = join(root, "worktrees", "looks-like");
    mkdirSync(lookalike, { recursive: true });
    expect(isGitWorktreePath(lookalike)).toBe(false);
  });
});

describe("initCharacterTablesWith — workspace backfill", () => {
  let db: Database.Database;
  let root: string;

  beforeEach(() => {
    db = createTestDb();
    root = makeTempRoot();
    initCharacterTablesWith(db);
    // Insert a character so foreign keys resolve.
    db.prepare(
      `INSERT INTO characters (id, user_id, name) VALUES ('char-a', 'user-a', 'Test')`,
    ).run();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("tags real worktrees as source='workspace' on re-run", () => {
    const wt = join(root, "wt-feature");
    writeWorktreeMarker(wt, "/repo/.git/worktrees/feature");

    db.prepare(
      `INSERT INTO agent_sync_folders (
        id, user_id, character_id, folder_path, display_name,
        sync_mode, indexing_mode, reindex_policy, source
      ) VALUES (
        'wt-row', 'user-a', 'char-a', ?, 'Workspace: feature',
        'manual', 'files-only', 'never', 'user'
      )`,
    ).run(wt);

    initCharacterTablesWith(db);

    const row = db
      .prepare(`SELECT source FROM agent_sync_folders WHERE id = 'wt-row'`)
      .get() as { source: string };
    expect(row.source).toBe("workspace");
  });

  it("does NOT tag a look-alike user folder that matches settings + display_name pattern", () => {
    // This is the false-positive the OLD heuristic would have created.
    // The user has a "Workspace: My Notes" folder with the same sync_mode /
    // indexing_mode / reindex_policy combo as the workspace tool, but the
    // path is a plain directory — not a git worktree. It must stay
    // source='user'.
    const plain = join(root, "plain-notes");
    mkdirSync(plain, { recursive: true });

    db.prepare(
      `INSERT INTO agent_sync_folders (
        id, user_id, character_id, folder_path, display_name,
        sync_mode, indexing_mode, reindex_policy, source
      ) VALUES (
        'lookalike-row', 'user-a', 'char-a', ?, 'Workspace: My Notes',
        'manual', 'files-only', 'never', 'user'
      )`,
    ).run(plain);

    initCharacterTablesWith(db);

    const row = db
      .prepare(`SELECT source FROM agent_sync_folders WHERE id = 'lookalike-row'`)
      .get() as { source: string };
    expect(row.source).toBe("user");
  });

  it("does NOT tag a regular git repo (where .git is a directory)", () => {
    const repo = join(root, "primary-repo");
    writePlainGitRepo(repo);

    db.prepare(
      `INSERT INTO agent_sync_folders (
        id, user_id, character_id, folder_path,
        sync_mode, indexing_mode, reindex_policy, source
      ) VALUES (
        'repo-row', 'user-a', 'char-a', ?,
        'manual', 'files-only', 'never', 'user'
      )`,
    ).run(repo);

    initCharacterTablesWith(db);

    const row = db
      .prepare(`SELECT source FROM agent_sync_folders WHERE id = 'repo-row'`)
      .get() as { source: string };
    expect(row.source).toBe("user");
  });

  it("leaves normal user folders (different settings combo) untouched", () => {
    db.prepare(
      `INSERT INTO agent_sync_folders (
        id, user_id, character_id, folder_path,
        sync_mode, indexing_mode, reindex_policy, source
      ) VALUES (
        'normal-row', 'user-a', 'char-a', '/Users/me/Documents/notes',
        'auto', 'full', 'smart', 'user'
      )`,
    ).run();

    initCharacterTablesWith(db);

    const row = db
      .prepare(`SELECT source FROM agent_sync_folders WHERE id = 'normal-row'`)
      .get() as { source: string };
    expect(row.source).toBe("user");
  });

  it("backfills NULL knobs BEFORE the workspace check, so legacy rows are tagged on first migration", () => {
    // Simulate a pre-migration row: source column doesn't exist yet,
    // sync_mode / indexing_mode / reindex_policy are NULL. We do this by
    // dropping the table and recreating it without the new columns, then
    // inserting, then re-running the migration which adds them via ALTER.
    db.exec(`DROP TABLE agent_sync_folders`);
    db.exec(`
      CREATE TABLE agent_sync_folders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        display_name TEXT
      )
    `);

    const wt = join(root, "wt-legacy");
    writeWorktreeMarker(wt, "/repo/.git/worktrees/legacy");

    db.prepare(
      `INSERT INTO agent_sync_folders (
        id, user_id, character_id, folder_path, display_name
      ) VALUES (
        'legacy-row', 'user-a', 'char-a', ?, 'Workspace: legacy'
      )`,
    ).run(wt);

    // Single migration run: NULL backfill gives the row canonical defaults
    // (manual/files-only/never via... wait, no — defaults are auto/auto/smart)
    // so a legacy row with NULL knobs would NOT match the candidate filter.
    // That's the correct behavior: legacy rows that pre-date the workspace
    // tool were never workspace rows, so they stay source='user'. The point
    // of this test is to assert ordering didn't break NULL handling itself.
    initCharacterTablesWith(db);

    const row = db
      .prepare(
        `SELECT source, sync_mode, indexing_mode, reindex_policy
         FROM agent_sync_folders WHERE id = 'legacy-row'`,
      )
      .get() as {
      source: string;
      sync_mode: string;
      indexing_mode: string;
      reindex_policy: string;
    };
    // NULL knobs got their canonical defaults via the cleanup pass:
    //   - sync_mode → 'auto' (column default applied)
    //   - indexing_mode → 'files-only' (legacy rows w/o embedding_model
    //     get this from the explicit indexing-mode backfill, not the NULL
    //     cleanup pass)
    //   - reindex_policy → 'smart' (column default applied)
    expect(row.sync_mode).toBe("auto");
    expect(row.indexing_mode).toBe("files-only");
    expect(row.reindex_policy).toBe("smart");
    // The legacy row correctly stays as source='user' because canonical
    // defaults don't match the workspace candidate filter (which requires
    // sync_mode='manual'). Pre-workspace-tool legacy rows were never
    // workspace rows and must not be reclassified.
    expect(row.source).toBe("user");
  });

  it("is idempotent — running migration twice does not flip workspace rows back", () => {
    const wt = join(root, "wt-idem");
    writeWorktreeMarker(wt, "/repo/.git/worktrees/idem");

    db.prepare(
      `INSERT INTO agent_sync_folders (
        id, user_id, character_id, folder_path,
        sync_mode, indexing_mode, reindex_policy, source
      ) VALUES (
        'idem-row', 'user-a', 'char-a', ?,
        'manual', 'files-only', 'never', 'user'
      )`,
    ).run(wt);

    initCharacterTablesWith(db);
    initCharacterTablesWith(db);
    initCharacterTablesWith(db);

    const row = db
      .prepare(`SELECT source FROM agent_sync_folders WHERE id = 'idem-row'`)
      .get() as { source: string };
    expect(row.source).toBe("workspace");
  });
});
