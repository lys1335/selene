import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { loadSettings } from "@/lib/settings/settings-manager";
import {
  cleanupOrphanedSyncFolders,
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

    const [foldersResult, tablesResult] = await Promise.all([
      cleanupOrphanedSyncFolders(),
      cleanupOrphanedVectorTables(),
    ]);

    return NextResponse.json({
      removedFolders: foldersResult.removed,
      removedTables: tablesResult.removed,
      keptFolders: foldersResult.kept,
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
