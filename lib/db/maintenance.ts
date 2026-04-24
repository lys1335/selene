import type Database from "better-sqlite3";

/**
 * Collect workspaceInfo from sessions about to be hard-purged so the caller
 * can tear down the associated git worktrees + sync-folder rows. Returns raw
 * JSON strings that should be parsed by the async caller (better-sqlite3 is
 * sync, but cleanupWorkspace is async, so we keep IO out of the prepared
 * statement here).
 */
function collectWorkspacesForPurge(
  sqlite: Database.Database,
  olderThan: string,
): Array<{ sessionId: string; metadata: string }> {
  try {
    return sqlite
      .prepare(
        `
        SELECT id AS sessionId, metadata
        FROM sessions
        WHERE status = 'deleted'
          AND updated_at < ?
          AND metadata IS NOT NULL
          AND json_extract(metadata, '$.workspaceInfo') IS NOT NULL
        `,
      )
      .all(olderThan) as Array<{ sessionId: string; metadata: string }>;
  } catch (err) {
    console.warn("[SQLite Maintenance] Failed to collect workspaces for purge:", err);
    return [];
  }
}

function recomputeVisibleConversationCounts(sqlite: Database.Database): void {
  const result = sqlite.prepare(`
    UPDATE sessions
    SET message_count = COALESCE((
      SELECT COUNT(*)
      FROM messages
      WHERE messages.session_id = sessions.id
        AND messages.role IN ('user', 'assistant')
        AND (
          messages.role != 'user'
          OR json_extract(messages.metadata, '$.livePromptInjected') IS NULL
          OR json_extract(messages.metadata, '$.livePromptInjected') = 0
        )
    ), 0)
    WHERE message_count != COALESCE((
      SELECT COUNT(*)
      FROM messages
      WHERE messages.session_id = sessions.id
        AND messages.role IN ('user', 'assistant')
        AND (
          messages.role != 'user'
          OR json_extract(messages.metadata, '$.livePromptInjected') IS NULL
          OR json_extract(messages.metadata, '$.livePromptInjected') = 0
        )
    ), 0)
  `).run();
  if (result.changes > 0) {
    console.log(`[SQLite Maintenance] Recomputed visible conversation counts for ${result.changes} session(s)`);
  }
}

export function runSessionMaintenance(sqlite: Database.Database): void {
  try {
    recomputeVisibleConversationCounts(sqlite);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Collect workspaceInfo from sessions about to be purged so we can tear
    // down the git worktree + sync-folder row asynchronously after the purge.
    // If we skip this step, a session hard-purge leaves the worktree row
    // pointing at a path that may still exist on disk — the boot sweep would
    // eventually catch it, but only if the worktree directory is also gone.
    const workspacesToCleanup = collectWorkspacesForPurge(sqlite, thirtyDaysAgo);

    const deletedResult = sqlite.prepare(`
      DELETE FROM sessions
      WHERE status = 'deleted'
        AND updated_at < ?
    `).run(thirtyDaysAgo);
    if (deletedResult.changes > 0) {
      console.log(`[SQLite Maintenance] Purged ${deletedResult.changes} deleted session(s) older than 30 days`);
    }

    // Fire-and-forget async cleanup for the collected workspaces. We cannot
    // await from this sync boot-time function; errors are swallowed + logged.
    if (workspacesToCleanup.length > 0) {
      void cleanupPurgedWorkspaces(workspacesToCleanup);
    }

    const archivedResult = sqlite.prepare(`
      UPDATE sessions
      SET status = 'archived', updated_at = datetime('now')
      WHERE status = 'active'
        AND COALESCE(message_count, 0) = 0
        AND updated_at < ?
    `).run(ninetyDaysAgo);
    if (archivedResult.changes > 0) {
      console.log(`[SQLite Maintenance] Archived ${archivedResult.changes} empty inactive session(s)`);
    }
  } catch (error) {
    console.warn("[SQLite Maintenance] Session maintenance failed:", error);
  }
}

/**
 * Async tear-down for workspaces whose sessions were just hard-purged. Kept
 * out of the sync boot path: imports the cleanup module lazily to avoid
 * pulling runGitCommand + vectordb into the connection init chain.
 */
async function cleanupPurgedWorkspaces(
  rows: Array<{ sessionId: string; metadata: string }>,
): Promise<void> {
  try {
    const { cleanupWorkspace } = await import("@/lib/workspace/cleanup");
    for (const { sessionId, metadata } of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(metadata) as Record<string, unknown>;
      } catch {
        continue;
      }
      const workspaceInfo = parsed?.workspaceInfo as
        | {
            type?: string;
            worktreePath?: string;
            syncFolderId?: string;
          }
        | undefined;
      if (!workspaceInfo || workspaceInfo.type === "local") continue;
      try {
        await cleanupWorkspace({
          syncFolderId: workspaceInfo.syncFolderId,
          worktreePath: workspaceInfo.worktreePath,
          trigger: "session-purge",
        });
      } catch (err) {
        console.warn(
          `[SQLite Maintenance] Failed to clean up purged workspace for session ${sessionId}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.warn("[SQLite Maintenance] cleanupPurgedWorkspaces failed to load:", err);
  }
}

