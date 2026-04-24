/**
 * Workspace Cleanup Helpers
 *
 * Event-driven cleanup for git worktrees + sync folder rows created by the
 * workspace tool. Called from multiple lifecycle events:
 *
 *   - `workspace({action: "delete"})` — explicit agent-initiated cleanup
 *   - Session soft-delete (DELETE /api/sessions/[id])
 *   - Session hard-purge (maintenance.ts, 30-day purge)
 *   - Character/agent deletion (DELETE /api/characters/[id])
 *
 * The boot-time sweep in `cleanupOrphanedWorkspaceFolders` (sync-service.ts)
 * remains as a safety net for crash-recovery and paths these hooks miss.
 */

import * as fs from "fs";
import { runGitCommand } from "@/lib/workspace/git-runner";
import { removeSyncFolder } from "@/lib/vectordb/sync-service";
import {
  recordWorkspaceDelete,
  recordWorkspaceCleanup,
  recordWorkspaceCleanupError,
} from "@/lib/workspace/metrics";

export interface WorkspaceCleanupInput {
  /** Absolute path to the git worktree on disk. Optional — if missing, only the row is cleaned. */
  worktreePath?: string;

  /** agent_sync_folders row ID for the workspace registration. Optional — if missing, only the worktree is cleaned. */
  syncFolderId?: string;

  /** Where the cleanup was triggered from. Used for logging + metrics. */
  trigger:
    | "workspace-tool-delete"
    | "session-delete"
    | "session-purge"
    | "character-delete";
}

export interface WorkspaceCleanupResult {
  syncFolderRemoved: boolean;
  worktreeRemoved: boolean;
  errors: string[];
}

/**
 * Best-effort cleanup of a single workspace. Never throws — collects errors and
 * continues so callers can attempt multiple cleanups in a loop without any one
 * failure aborting the batch.
 */
export async function cleanupWorkspace(
  input: WorkspaceCleanupInput,
): Promise<WorkspaceCleanupResult> {
  const { worktreePath, syncFolderId, trigger } = input;
  const result: WorkspaceCleanupResult = {
    syncFolderRemoved: false,
    worktreeRemoved: false,
    errors: [],
  };

  // 1. Remove sync folder row first (so file tools can't continue accessing
  // a worktree that's about to be deleted from disk).
  if (syncFolderId) {
    try {
      await removeSyncFolder(syncFolderId);
      result.syncFolderRemoved = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`removeSyncFolder failed: ${msg}`);
      recordWorkspaceCleanupError();
      console.error(
        `[workspace-cleanup:${trigger}] Failed to remove sync folder ${syncFolderId}:`,
        err,
      );
    }
  }

  // 2. Remove the git worktree if the directory still exists on disk.
  if (worktreePath && isSafeAbsolutePath(worktreePath) && fs.existsSync(worktreePath)) {
    try {
      const commonDir = (
        await runGitCommand(worktreePath, ["rev-parse", "--git-common-dir"])
      ).trim();
      const mainRepoDir = fs.realpathSync(
        commonDir.endsWith("/.git") || commonDir.endsWith("\\.git")
          ? commonDir.replace(/[/\\]\.git$/, "")
          : commonDir + "/..",
      );
      await runGitCommand(mainRepoDir, [
        "worktree",
        "remove",
        worktreePath,
        "--force",
      ]);
      result.worktreeRemoved = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`git worktree remove failed: ${msg}`);
      recordWorkspaceCleanupError();
      console.error(
        `[workspace-cleanup:${trigger}] Failed to remove git worktree at ${worktreePath}:`,
        err,
      );
    }
  }

  // 3. Record metrics.
  if (trigger === "workspace-tool-delete") {
    recordWorkspaceDelete();
  } else {
    // Secondary cleanup triggers (session/character lifecycle) roll up under
    // "cleanup" for observability so we can distinguish user-intentional
    // deletion from garbage-collection.
    recordWorkspaceCleanup(trigger);
  }

  return result;
}

/**
 * Minimal path-safety check — mirrors the validator in workspace-tool.ts.
 * We duplicate a tiny subset here to keep this module dependency-free at the
 * tool layer and safe to import from API routes + maintenance.
 */
function isSafeAbsolutePath(p: string): boolean {
  if (typeof p !== "string") return false;
  const candidate = p.trim();
  if (!candidate) return false;
  if (/[;&|`$(){}!#]/.test(candidate)) return false;
  const isWindowsAbsolute =
    /^[a-zA-Z]:[\\/]/.test(candidate) ||
    /^\\\\[^\\/]+[\\/][^\\/]+/.test(candidate) ||
    /^\\\\\?[\\/][a-zA-Z]:[\\/]/.test(candidate);
  return candidate.startsWith("/") || isWindowsAbsolute;
}
