import { NextResponse } from "next/server";
import { db } from "@/lib/db/sqlite-client";
import { agentSyncFolders, characters } from "@/lib/db/sqlite-character-schema";
import { eq, or } from "drizzle-orm";
import { isVectorDBEnabled } from "@/lib/vectordb/client";

export interface SyncStatusFolder {
  id: string;
  characterId: string;
  characterName: string | null;
  folderPath: string;
  displayName: string | null;
  status: "pending" | "syncing" | "synced" | "error" | "paused";
  fileCount: number | null;
  chunkCount: number | null;
  totalFiles: number | null;
  progress: number | null; // 0-1 ratio of filesProcessed/totalFiles
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface GlobalSyncStatus {
  isEnabled: boolean;
  isSyncing: boolean;
  activeSyncs: SyncStatusFolder[];
  pendingSyncs: SyncStatusFolder[];
  recentErrors: SyncStatusFolder[];
  totalFolders: number;
  totalSyncingOrPending: number;
  foldersComplete: number;
}

/**
 * GET /api/sync-status
 * Returns the global sync status for the vector database
 */
export async function GET() {
  try {
    const isEnabled = isVectorDBEnabled();

    if (!isEnabled) {
      return NextResponse.json({
        isEnabled: false,
        isSyncing: false,
        activeSyncs: [],
        pendingSyncs: [],
        recentErrors: [],
        totalFolders: 0,
        totalSyncingOrPending: 0,
        foldersComplete: 0,
      } as GlobalSyncStatus);
    }

    // Get all folders with their character names
    const allFolders = await db
      .select({
        id: agentSyncFolders.id,
        characterId: agentSyncFolders.characterId,
        folderPath: agentSyncFolders.folderPath,
        displayName: agentSyncFolders.displayName,
        status: agentSyncFolders.status,
        fileCount: agentSyncFolders.fileCount,
        chunkCount: agentSyncFolders.chunkCount,
        lastSyncedAt: agentSyncFolders.lastSyncedAt,
        lastError: agentSyncFolders.lastError,
        lastRunMetadata: agentSyncFolders.lastRunMetadata,
        characterName: characters.name,
      })
      .from(agentSyncFolders)
      .leftJoin(characters, eq(agentSyncFolders.characterId, characters.id));

    // Categorize folders
    const activeSyncs: SyncStatusFolder[] = [];
    const pendingSyncs: SyncStatusFolder[] = [];
    const recentErrors: SyncStatusFolder[] = [];

    for (const folder of allFolders) {
      // Extract progress from lastRunMetadata when syncing
      const metadata = folder.lastRunMetadata as Record<string, unknown> | null;
      const totalFiles = (metadata && typeof metadata.totalFiles === "number") ? metadata.totalFiles : null;
      const filesProcessed = (metadata && typeof metadata.filesProcessed === "number") ? metadata.filesProcessed : null;
      const progress = (totalFiles !== null && totalFiles > 0 && filesProcessed !== null)
        ? Math.min(filesProcessed / totalFiles, 1)
        : null;

      const statusFolder: SyncStatusFolder = {
        id: folder.id,
        characterId: folder.characterId,
        characterName: folder.characterName,
        folderPath: folder.folderPath,
        displayName: folder.displayName,
        status: folder.status as SyncStatusFolder["status"],
        fileCount: folder.fileCount,
        chunkCount: folder.chunkCount,
        totalFiles: folder.status === "syncing" ? totalFiles : null,
        progress: folder.status === "syncing" ? progress : null,
        lastSyncedAt: folder.lastSyncedAt,
        lastError: folder.lastError,
      };

      if (folder.status === "syncing") {
        activeSyncs.push(statusFolder);
      } else if (folder.status === "pending") {
        pendingSyncs.push(statusFolder);
      } else if (folder.status === "error" || (folder.status === "paused" && folder.lastError)) {
        recentErrors.push(statusFolder);
      }
    }

    const foldersComplete = allFolders.filter(f => f.status === "synced").length;

    const response: GlobalSyncStatus = {
      isEnabled,
      isSyncing: activeSyncs.length > 0,
      activeSyncs,
      pendingSyncs,
      recentErrors,
      totalFolders: allFolders.length,
      totalSyncingOrPending: activeSyncs.length + pendingSyncs.length,
      foldersComplete,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[SyncStatus] Error getting sync status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get sync status" },
      { status: 500 }
    );
  }
}
