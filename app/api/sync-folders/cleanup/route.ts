import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { loadSettings } from "@/lib/settings/settings-manager";
import {
  cleanupOrphanedSyncFolders,
  cleanupOrphanedInheritedFolders,
  cleanupOrphanedVectorTables,
} from "@/lib/vectordb/sync-service";

/**
 * POST /api/sync-folders/cleanup
 *
 * Removes orphaned sync folder DB rows (and their associated vector tables) for
 * characters that no longer exist.  Useful after bulk workspace teardowns or
 * whenever sub-agent lifecycle cleanup may have been missed.
 *
 * Returns:
 *   { removedFolders: string[], removedTables: string[], keptFolders: number, keptTables: number }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth(req);
    const settings = loadSettings();
    await getOrCreateLocalUser(userId, settings.localUserEmail);

    // Run in sequence to mirror startup: orphaned folders first, then
    // inherited copies, then stale vector tables.
    const foldersResult = await cleanupOrphanedSyncFolders();
    const inheritedResult = await cleanupOrphanedInheritedFolders();
    const tablesResult = await cleanupOrphanedVectorTables();

    return NextResponse.json({
      removedFolders: foldersResult.removed,
      removedInherited: inheritedResult.removed,
      removedTables: tablesResult.removed,
      keptFolders: foldersResult.kept,
      keptInherited: inheritedResult.kept,
      keptTables: tablesResult.kept.length,
    });
  } catch (error) {
    console.error("[SyncFoldersCleanup] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed" },
      { status: 500 }
    );
  }
}
