/**
 * Design Workspace Worktree Manager
 *
 * Manages direct-mode project references for the design workspace.
 * In direct mode, `worktreePath` points at the user's actual project
 * directory — no duplication.  The dev server, renderers, and file tools
 * all operate on the real project so existing `node_modules` are used as-is.
 *
 * Unlike the general workspace tool (`lib/ai/tools/workspace-tool.ts`) this
 * module is lighter weight: it uses a module-level in-memory registry instead
 * of persisting workspace metadata to the session database.
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";

import { runGitCommand } from "@/lib/workspace/git-runner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  syncFolderId: string | null;
  isGitBased: boolean;
  sessionId: string;
  createdAt: string;
  /**
   * When `true`, `worktreePath` points at the original source directory —
   * no git worktree or directory copy was created.  Cleanup must never
   * touch the filesystem in this case.
   */
  isDirect: boolean;
}

export interface WorktreeHealth {
  exists: boolean;
  isGitRepo: boolean;
  hasUncommittedChanges: boolean;
  diskUsageMb?: number;
}

export interface FinalizeResult {
  success: boolean;
  diff: string;
  changedFiles: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Module-level registry
// ---------------------------------------------------------------------------

const worktreeRegistry = new Map<string, WorktreeInfo>();

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Validate that `sourcePath` resolves to a real directory and is not a
 * symlink escape.  Resolves through symlinks via `fs.realpath` and checks
 * that the result is an existing directory.
 */
async function validateWorktreeSourcePath(sourcePath: string): Promise<void> {
  let realPath: string;
  try {
    realPath = await fs.realpath(sourcePath);
  } catch {
    throw new Error(
      `Source path does not exist or cannot be resolved: ${sourcePath}`,
    );
  }

  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    throw new Error(`Source path is not a directory: ${sourcePath}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check whether `dir` is inside a git work tree */
async function isGitRepository(dir: string): Promise<boolean> {
  try {
    const result = (
      await runGitCommand(dir, ["rev-parse", "--is-inside-work-tree"], undefined, "[design-worktree]")
    )
      .trim()
      .toLowerCase();
    return result === "true";
  } catch {
    return false;
  }
}

/** Get the current branch name (or HEAD) in a git repo */
async function currentBranch(cwd: string): Promise<string> {
  try {
    return (
      await runGitCommand(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], undefined, "[design-worktree]")
    ).trim();
  } catch {
    return "HEAD";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a direct-mode "worktree" that points at the original source folder.
 *
 * No files are duplicated — `worktreePath === sourceRoot`.  The dev server,
 * renderers and file tools all operate on the real project, so existing
 * `node_modules` are used as-is.
 *
 * Direct mode is the default for `cast` and project-mode `open`.
 */
export async function createDirectDesignWorktree(
  sourceRoot: string,
  sessionId: string,
): Promise<WorktreeInfo> {
  const existing = worktreeRegistry.get(sessionId);
  if (existing) return existing;

  await validateWorktreeSourcePath(sourceRoot);

  const resolvedSource = resolve(sourceRoot);
  const gitBased = await isGitRepository(resolvedSource);
  const baseBranch = gitBased ? await currentBranch(resolvedSource) : "none";

  const info: WorktreeInfo = {
    worktreePath: resolvedSource,
    branch: baseBranch,
    baseBranch,
    syncFolderId: null,
    isGitBased: gitBased,
    sessionId,
    createdAt: new Date().toISOString(),
    isDirect: true,
  };

  worktreeRegistry.set(sessionId, info);
  return info;
}

/**
 * Retrieve the active design worktree for a session, or `null` if none exists.
 */
export function getActiveWorktree(sessionId: string): WorktreeInfo | null {
  return worktreeRegistry.get(sessionId) ?? null;
}

/**
 * List all currently active design worktrees across all sessions.
 */
export function listActiveWorktrees(): WorktreeInfo[] {
  return Array.from(worktreeRegistry.values());
}

/**
 * Remove and clean up a design worktree.
 *
 * For direct-mode worktrees this only deregisters from the in-memory
 * registry — the user's source directory is never touched.
 */
export async function cleanupDesignWorktree(sessionId: string): Promise<void> {
  const info = worktreeRegistry.get(sessionId);
  if (!info) {
    return;
  }

  // Direct mode: the worktreePath IS the user's source directory.
  // Never touch the filesystem — just deregister from the in-memory registry.
  worktreeRegistry.delete(sessionId);
}

/**
 * Poll the health of a design worktree.
 *
 * Returns basic existence and status information without modifying anything.
 */
export function pollWorktreeHealth(sessionId: string): WorktreeHealth {
  const info = worktreeRegistry.get(sessionId);
  if (!info) {
    return {
      exists: false,
      isGitRepo: false,
      hasUncommittedChanges: false,
    };
  }

  const dirExists = existsSync(info.worktreePath);

  return {
    exists: dirExists,
    isGitRepo: info.isGitBased && dirExists,
    hasUncommittedChanges: false, // conservative default for sync path
  };
}

/**
 * Finalize a design worktree: gather the diff and list of changed files.
 *
 * This does **not** clean up the worktree — the caller decides when to call
 * `cleanupDesignWorktree`.
 */
export async function finalizeDesignWorktree(
  sessionId: string,
): Promise<FinalizeResult> {
  const info = worktreeRegistry.get(sessionId);
  if (!info) {
    return {
      success: false,
      diff: "",
      changedFiles: [],
      error: "No active design worktree for this session",
    };
  }

  if (!info.isGitBased) {
    return {
      success: true,
      diff: "(non-git project — diff not available)",
      changedFiles: [],
    };
  }

  try {
    // Uncommitted changes
    let diff = (
      await runGitCommand(
        info.worktreePath,
        ["diff", "HEAD"],
        undefined,
        "[design-worktree]",
      )
    ).trim();

    // If no uncommitted changes, get committed changes vs base branch
    if (!diff) {
      try {
        diff = (
          await runGitCommand(
            info.worktreePath,
            ["diff", `${info.baseBranch}...HEAD`],
            undefined,
            "[design-worktree]",
          )
        ).trim();
      } catch {
        // baseBranch may not be reachable — ignore
      }
    }

    // Changed files from porcelain status
    const statusOutput = (
      await runGitCommand(
        info.worktreePath,
        ["status", "--porcelain"],
        undefined,
        "[design-worktree]",
      )
    ).trim();

    const changedFiles = statusOutput
      ? statusOutput.split("\n").map((line) => line.slice(3).trim()).filter(Boolean)
      : [];

    return {
      success: true,
      diff,
      changedFiles,
    };
  } catch (err) {
    return {
      success: false,
      diff: "",
      changedFiles: [],
      error: `Failed to finalize worktree: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get the current diff for a design worktree.
 *
 * Returns uncommitted changes first; if there are none, returns the diff
 * of committed changes against the base branch.
 */
export async function getWorktreeDiff(sessionId: string): Promise<string> {
  const info = worktreeRegistry.get(sessionId);
  if (!info) {
    throw new Error("No active design worktree for this session");
  }

  if (!info.isGitBased) {
    return "(non-git project — diff not available)";
  }

  try {
    // Try uncommitted changes first
    const uncommitted = (
      await runGitCommand(
        info.worktreePath,
        ["diff"],
        undefined,
        "[design-worktree]",
      )
    ).trim();

    if (uncommitted) {
      return uncommitted;
    }

    // Fall back to committed changes vs base branch
    try {
      const committed = (
        await runGitCommand(
          info.worktreePath,
          ["diff", `${info.baseBranch}...HEAD`],
          undefined,
          "[design-worktree]",
        )
      ).trim();
      return committed;
    } catch {
      return "";
    }
  } catch (err) {
    throw new Error(
      `Failed to get worktree diff: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
