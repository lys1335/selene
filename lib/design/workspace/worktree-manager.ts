/**
 * Design Workspace Worktree Manager
 *
 * Creates and manages Git worktrees (or directory-copy fallbacks) for
 * design workspace project-native mode.  Provides isolated copies of user
 * projects so the AI can safely edit files without touching the original source.
 *
 * Unlike the general workspace tool (`lib/ai/tools/workspace-tool.ts`) this
 * module is lighter weight: it uses a module-level in-memory registry instead
 * of persisting workspace metadata to the session database.
 */

import fs from "fs/promises";
import { existsSync, mkdirSync, lstatSync } from "fs";
import os from "os";
import { join, resolve, dirname, relative } from "path";

import { runGitCommand } from "@/lib/workspace/git-runner";
import {
  addSyncFolder,
  removeSyncFolder,
  setSyncFolderStatus,
} from "@/lib/vectordb/sync-service";

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
// Constants
// ---------------------------------------------------------------------------

/** Broad set of extensions relevant to design-workspace sync folders */
const DESIGN_WORKSPACE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "vue", "svelte", "astro",
  "php", "blade.php", "py", "rb",
  "json", "yaml", "yml", "toml",
  "html", "css", "scss", "less", "sass",
  "md", "txt", "svg",
];

/** Manifest file written into each worktree root for crash recovery */
const WORKTREE_MANIFEST_FILE = ".selene-worktree-info.json";

/** Lock file prefix for preventing concurrent worktree creation */
const LOCKFILE_DIR = join(os.tmpdir(), "selene-design-locks");

/** Snapshot manifest for non-git worktrees to enable change detection */
const SNAPSHOT_MANIFEST_FILE = ".selene-manifest.json";

export interface ManifestEntry {
  /** File path relative to worktree root */
  path: string;
  /** File size in bytes */
  size: number;
  /** Last modification time (ISO string) */
  mtime: string;
}

export interface SnapshotManifest {
  createdAt: string;
  entries: ManifestEntry[];
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
// File-based lock for concurrent worktree creation
// ---------------------------------------------------------------------------

async function acquireSessionLock(sessionId: string): Promise<string> {
  const lockPath = join(LOCKFILE_DIR, `${sessionId}.lock`);
  try {
    await fs.mkdir(LOCKFILE_DIR, { recursive: true });
    // Exclusive create — fails if file already exists
    await fs.writeFile(lockPath, String(Date.now()), { flag: "wx" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EEXIST")) {
      throw new Error(
        `Concurrent worktree creation for session ${sessionId} — lock file exists`,
      );
    }
    // If mkdir/write fails for another reason, log but continue (best-effort)
    console.warn("[design-worktree] Could not acquire lock (non-fatal):", msg);
  }
  return lockPath;
}

async function releaseSessionLock(lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Manifest persistence for crash recovery (W1)
// ---------------------------------------------------------------------------

async function writeWorktreeManifest(info: WorktreeInfo): Promise<void> {
  try {
    const manifest = {
      sessionId: info.sessionId,
      sourceRoot: info.worktreePath,
      branch: info.branch,
      baseBranch: info.baseBranch,
      isGitBased: info.isGitBased,
      createdAt: info.createdAt,
    };
    await fs.writeFile(
      join(info.worktreePath, WORKTREE_MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    // Non-fatal — manifest is a recovery aid
  }
}

/**
 * Scan for orphaned worktrees that have manifest files but are not in the
 * in-memory registry.  Returns their manifest data for potential cleanup.
 */
export async function scanOrphanedWorktrees(): Promise<WorktreeInfo[]> {
  const orphans: WorktreeInfo[] = [];

  // Scan temp dir for directory-copy worktrees
  const tempBase = join(os.tmpdir(), "selene-design-worktrees");
  try {
    const entries = await fs.readdir(tempBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(tempBase, entry.name, WORKTREE_MANIFEST_FILE);
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(raw);
        if (manifest.sessionId && !worktreeRegistry.has(manifest.sessionId)) {
          orphans.push({
            worktreePath: join(tempBase, entry.name),
            branch: manifest.branch ?? "none",
            baseBranch: manifest.baseBranch ?? "none",
            syncFolderId: null,
            isGitBased: manifest.isGitBased ?? false,
            sessionId: manifest.sessionId,
            createdAt: manifest.createdAt ?? "unknown",
          });
        }
      } catch {
        // No manifest or unreadable — skip
      }
    }
  } catch {
    // Temp dir may not exist yet
  }

  return orphans;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Slugify a string for use in branch / directory names */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

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
 * Create a design worktree for the given session.
 *
 * If `sourceRoot` is a git repository a proper `git worktree add` is used;
 * otherwise the directory is copied to a temporary location.  The worktree is
 * also registered as a sync folder so that file tools can access it.
 *
 * If the session already has an active worktree the existing one is returned.
 */
export async function createDesignWorktree(
  sourceRoot: string,
  sessionId: string,
  options?: { userId?: string; characterId?: string },
): Promise<WorktreeInfo> {
  // Return existing worktree for this session if present
  const existing = worktreeRegistry.get(sessionId);
  if (existing) {
    return existing;
  }

  // Validate source path before proceeding
  await validateWorktreeSourcePath(sourceRoot);

  // Acquire file-based lock to prevent concurrent creation for same session
  const lockPath = await acquireSessionLock(sessionId);

  try {
    return await _createDesignWorktreeInner(sourceRoot, sessionId, options);
  } finally {
    await releaseSessionLock(lockPath);
  }
}

/** Inner implementation — called under session lock */
async function _createDesignWorktreeInner(
  sourceRoot: string,
  sessionId: string,
  options?: { userId?: string; characterId?: string },
): Promise<WorktreeInfo> {
  // Double-check after acquiring lock (another call may have completed)
  const existingAfterLock = worktreeRegistry.get(sessionId);
  if (existingAfterLock) {
    return existingAfterLock;
  }

  const resolvedSource = resolve(sourceRoot);
  const gitBased = await isGitRepository(resolvedSource);
  const baseBranch = gitBased ? await currentBranch(resolvedSource) : "none";

  let worktreePath: string;
  let branch: string;
  let syncFolderId: string | null = null;

  if (gitBased) {
    // ---- Git-based worktree ------------------------------------------------
    branch = `design-workspace/${sessionId}-${Date.now()}`;
    const branchSlug = slug(branch);
    worktreePath = resolve(resolvedSource, "..", "worktrees", `design-${branchSlug}`);

    // Ensure parent directory exists
    const parentDir = dirname(worktreePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    try {
      await runGitCommand(
        resolvedSource,
        ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
        undefined,
        "[design-worktree]",
      );
    } catch (err) {
      // Branch may already exist — retry without -b
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        try {
          await runGitCommand(
            resolvedSource,
            ["worktree", "add", worktreePath, branch],
            undefined,
            "[design-worktree]",
          );
        } catch (retryErr) {
          throw new Error(
            `Failed to create design worktree: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
        }
      } else {
        throw new Error(`Failed to create design worktree: ${msg}`);
      }
    }
  } else {
    // ---- Directory-copy fallback -------------------------------------------
    branch = "none";
    const targetDir = join(
      os.tmpdir(),
      "selene-design-worktrees",
      `${sessionId}-${Date.now()}`,
    );

    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.cp(resolvedSource, targetDir, {
        recursive: true,
        dereference: false,
        filter: (src: string) => {
          // Reject symlinks and junctions to prevent symlink escape
          try {
            const stat = lstatSync(src);
            return !stat.isSymbolicLink();
          } catch {
            return false;
          }
        },
      });
    } catch (cpErr) {
      throw new Error(
        `Failed to copy project for design worktree: ${cpErr instanceof Error ? cpErr.message : String(cpErr)}`,
      );
    }

    worktreePath = targetDir;

    // Create snapshot manifest for change detection during sync-back
    try {
      await saveSnapshotManifest(worktreePath);
    } catch (manifestErr) {
      console.error("[design-worktree] Failed to save snapshot manifest (non-fatal):", manifestErr);
    }
  }

  // ---- Register sync folder ------------------------------------------------
  try {
    const userId = options?.userId ?? "system";
    const characterId = options?.characterId ?? "default";

    syncFolderId = await addSyncFolder({
      userId,
      characterId,
      folderPath: worktreePath,
      displayName: `Design Workspace: ${sessionId}`,
      recursive: true,
      includeExtensions: DESIGN_WORKSPACE_EXTENSIONS,
      syncMode: "manual",
      indexingMode: "files-only",
      reindexPolicy: "never",
    });

    // Mark as "synced" immediately so file tools recognize it as ready
    await setSyncFolderStatus(syncFolderId, "synced");
  } catch (syncErr) {
    console.error(
      "[design-worktree] Failed to register sync folder (non-fatal):",
      syncErr,
    );
    // Non-fatal — the worktree still exists and can be used via executeCommand
  }

  // ---- Build and register info ---------------------------------------------
  const info: WorktreeInfo = {
    worktreePath,
    branch,
    baseBranch,
    syncFolderId,
    isGitBased: gitBased,
    sessionId,
    createdAt: new Date().toISOString(),
  };

  worktreeRegistry.set(sessionId, info);

  // Persist manifest for crash recovery (W1)
  await writeWorktreeManifest(info);

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
 * For git-based worktrees this runs `git worktree remove` and deletes the
 * temporary branch.  For directory-copy fallbacks the target directory is
 * deleted.  The sync folder registration is removed in both cases.
 */
export async function cleanupDesignWorktree(sessionId: string): Promise<void> {
  const info = worktreeRegistry.get(sessionId);
  if (!info) {
    return;
  }

  // Remove sync folder (non-fatal)
  if (info.syncFolderId) {
    try {
      await removeSyncFolder(info.syncFolderId);
    } catch (err) {
      console.error(
        "[design-worktree] Failed to remove sync folder (non-fatal):",
        err,
      );
    }
  }

  if (info.isGitBased) {
    try {
      // Check for uncommitted changes before removing
      try {
        const porcelain = (
          await runGitCommand(
            info.worktreePath,
            ["status", "--porcelain"],
            undefined,
            "[design-worktree]",
          )
        ).trim();
        if (porcelain) {
          console.warn(
            `[design-worktree] Worktree for session ${sessionId} has uncommitted changes:\n${porcelain}`,
          );
        }
      } catch {
        // If status check fails, proceed with cleanup anyway
      }

      // Discover the main repo directory via --git-common-dir
      const commonDir = (
        await runGitCommand(
          info.worktreePath,
          ["rev-parse", "--git-common-dir"],
          undefined,
          "[design-worktree]",
        )
      ).trim();
      const mainRepoDir = resolve(info.worktreePath, commonDir, "..");

      // Try without --force first; fall back to --force if needed
      try {
        await runGitCommand(
          mainRepoDir,
          ["worktree", "remove", info.worktreePath],
          undefined,
          "[design-worktree]",
        );
      } catch {
        await runGitCommand(
          mainRepoDir,
          ["worktree", "remove", info.worktreePath, "--force"],
          undefined,
          "[design-worktree]",
        );
      }

      // Delete the temporary branch — use safe -d first, fall back to -D
      try {
        await runGitCommand(
          mainRepoDir,
          ["branch", "-d", info.branch],
          undefined,
          "[design-worktree]",
        );
      } catch {
        try {
          await runGitCommand(
            mainRepoDir,
            ["branch", "-D", info.branch],
            undefined,
            "[design-worktree]",
          );
        } catch {
          // Branch may already have been deleted — ignore
        }
      }
    } catch (gitErr) {
      console.error(
        "[design-worktree] Git worktree cleanup failed, attempting fs fallback:",
        gitErr,
      );
      // Fallback: just remove the directory
      try {
        await fs.rm(info.worktreePath, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  } else {
    try {
      await fs.rm(info.worktreePath, { recursive: true, force: true });
    } catch (rmErr) {
      console.error("[design-worktree] Failed to remove directory:", rmErr);
    }
  }

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

  // For synchronous health polling we do a quick check.  A full `git status`
  // would be async; callers needing that should use getWorktreeDiff instead.
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
      diff: "(non-git worktree — diff not available)",
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
        // baseBranch may not be reachable in the worktree — ignore
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
    return "(non-git worktree — diff not available)";
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

// ---------------------------------------------------------------------------
// Snapshot manifest for non-git worktrees
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory and collect file entries.
 * Skips the manifest file itself, node_modules, and .git directories.
 */
async function walkDirectory(dir: string, root: string): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let items: string[];
  try {
    items = await fs.readdir(dir);
  } catch {
    return entries;
  }

  for (const name of items) {
    if (name === "node_modules" || name === ".git" || name === SNAPSHOT_MANIFEST_FILE) {
      continue;
    }
    const fullPath = join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const subEntries = await walkDirectory(fullPath, root);
        entries.push(...subEntries);
      } else if (stat.isFile()) {
        entries.push({
          path: relative(root, fullPath).replace(/\\/g, "/"),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    } catch {
      // Skip inaccessible files
    }
  }

  return entries;
}

/**
 * Save a snapshot manifest of all files in a non-git worktree.
 * Used for change detection during sync-back.
 */
export async function saveSnapshotManifest(worktreePath: string): Promise<void> {
  const entries = await walkDirectory(worktreePath, worktreePath);
  const manifest: SnapshotManifest = {
    createdAt: new Date().toISOString(),
    entries,
  };
  await fs.writeFile(
    join(worktreePath, SNAPSHOT_MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

/**
 * Load the snapshot manifest from a non-git worktree.
 * Returns null if no manifest exists.
 */
export async function loadSnapshotManifest(worktreePath: string): Promise<SnapshotManifest | null> {
  const manifestPath = join(worktreePath, SNAPSHOT_MANIFEST_FILE);
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as SnapshotManifest;
  } catch {
    return null;
  }
}
