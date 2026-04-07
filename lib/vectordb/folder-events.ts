/**
 * Event system for folder changes
 * Separated to avoid pulling in heavy server-side dependencies (fs, chokidar) 
 * into other modules like MCPClientManager.
 */

export type FolderChangeEvent = {
    type: "added" | "removed" | "updated" | "primary_changed"
    | "mcp_reload_started" | "mcp_reload_completed" | "mcp_reload_failed"
    | "file_watcher_sync";
    folderId: string;
    wasPrimary?: boolean;
    folderPath?: string;
    // MCP reload tracking fields
    serverName?: string;
    totalServers?: number;
    completedServers?: number;
    estimatedDuration?: number; // milliseconds
    error?: string;
    // File-watcher sync completion fields
    filesIndexed?: number;
    elapsedMs?: number;
    syncReason?: "file_watcher" | "user_manual" | "scheduled";
};

type FolderChangeListener = (characterId: string, event: FolderChangeEvent) => void;

// Use globalThis to ensure a single shared listeners array across all module copies.
// Turbopack/Next.js standalone builds can duplicate this module into separate chunks
// (one for file-watcher, one for API routes), creating two independent arrays.
// globalThis ensures both contexts share the same listener registry.
const GLOBAL_KEY = "__selene_folder_change_listeners__" as const;

function getListeners(): FolderChangeListener[] {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
        (globalThis as Record<string, unknown>)[GLOBAL_KEY] = [];
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as FolderChangeListener[];
}

/**
 * Subscribe to folder changes
 */
export function onFolderChange(listener: FolderChangeListener) {
    const listeners = getListeners();
    listeners.push(listener);
    console.error(`[FolderEvents] Listener registered (total: ${listeners.length})`);
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx > -1) listeners.splice(idx, 1);
    };
}

/**
 * Notify listeners of a folder change
 */
export function notifyFolderChange(characterId: string, event: FolderChangeEvent) {
    const listeners = getListeners();
    console.error(`[FolderEvents] Notifying ${listeners.length} listeners of ${event.type} event (globalThis key: ${GLOBAL_KEY})`);
    listeners.forEach(listener => {
        try {
            listener(characterId, event);
        } catch (error) {
            console.error("[FolderEvents] Listener error:", error);
        }
    });
}
