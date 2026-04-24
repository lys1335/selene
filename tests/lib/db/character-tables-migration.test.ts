import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGitWorktreePath } from "@/lib/db/migrations/character-tables";

describe("isGitWorktreePath", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "selene-worktree-test-"));
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns true for a path whose .git is a pointer file into /.git/worktrees/", () => {
    const worktreePath = join(tmpRoot, "feature-branch");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(worktreePath, ".git"),
      `gitdir: /Users/dev/repo/.git/worktrees/feature-branch\n`,
    );
    expect(isGitWorktreePath(worktreePath)).toBe(true);
  });

  it("returns false for a regular git repo (.git is a directory)", () => {
    const repoPath = join(tmpRoot, "regular-repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    expect(isGitWorktreePath(repoPath)).toBe(false);
  });

  it("returns false for a plain directory with no .git", () => {
    const plainPath = join(tmpRoot, "plain-dir");
    mkdirSync(plainPath, { recursive: true });
    expect(isGitWorktreePath(plainPath)).toBe(false);
  });

  it("returns false when .git is a file but doesn't point to a worktree", () => {
    const fakePath = join(tmpRoot, "submodule-like");
    mkdirSync(fakePath, { recursive: true });
    // Submodules use .git pointer files too, but they reference ../.git/modules/..., not worktrees/
    writeFileSync(
      join(fakePath, ".git"),
      `gitdir: /Users/dev/repo/.git/modules/submodule\n`,
    );
    expect(isGitWorktreePath(fakePath)).toBe(false);
  });

  it("returns false when path does not exist", () => {
    expect(isGitWorktreePath(join(tmpRoot, "does-not-exist"))).toBe(false);
  });

  it("handles whitespace variations in gitdir pointer", () => {
    const worktreePath = join(tmpRoot, "feature-branch-2");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(worktreePath, ".git"),
      `  gitdir:   /Users/dev/repo/.git/worktrees/feature-branch-2  \n`,
    );
    expect(isGitWorktreePath(worktreePath)).toBe(true);
  });
});
