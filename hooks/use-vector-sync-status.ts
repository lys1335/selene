"use client";

import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import type { GlobalSyncStatus, SyncStatusFolder, FileWatcherSyncEvent } from "@/app/api/sync-status/route";

// Default empty state
const DEFAULT_STATUS: GlobalSyncStatus = {
  isEnabled: false,
  isSyncing: false,
  activeSyncs: [],
  pendingSyncs: [],
  recentErrors: [],
  folders: [],
  totalFolders: 0,
  totalSyncingOrPending: 0,
  foldersComplete: 0,
  recentFileWatcherSyncs: [],
};

// Polling intervals by tier
const POLL_INTERVALS = {
  active: 5000,   // 5 seconds when syncing
  idle: 10000,    // 10 seconds when idle — must be well under the 75s event TTL
  disabled: 600000, // 10 minutes when vector DB is disabled
} as const;

type PollTier = keyof typeof POLL_INTERVALS;

function getPollTier(status: GlobalSyncStatus): PollTier {
  if (!status.isEnabled) return "disabled";
  if (status.isSyncing || status.pendingSyncs.length > 0 || status.activeSyncs.length > 0) return "active";
  // Boost polling when there are recent file-watcher events so toasts appear quickly
  if (status.recentFileWatcherSyncs && status.recentFileWatcherSyncs.length > 0) return "active";
  return "idle";
}

interface VectorSyncContextType {
  status: GlobalSyncStatus;
  isLoading: boolean;
  error: string | null;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  refresh: () => Promise<void>;
  cancelSync: (folderId: string) => Promise<void>;
}

const VectorSyncContext = createContext<VectorSyncContextType | null>(null);

const DEFAULT_CONTEXT: VectorSyncContextType = {
  status: DEFAULT_STATUS,
  isLoading: false,
  error: null,
  isExpanded: false,
  setIsExpanded: () => { },
  refresh: async () => { },
  cancelSync: async () => { },
};

export function useVectorSyncStatus() {
  const context = useContext(VectorSyncContext);
  return context ?? DEFAULT_CONTEXT;
}

interface UseVectorSyncStatusInternalResult {
  status: GlobalSyncStatus;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Internal hook that handles the actual fetching logic.
 *
 * Memoizes the status object so consumers only re-render when values actually change.
 * Uses ref-based tier tracking so the polling timer only resets on tier transitions.
 */
export function useVectorSyncStatusInternal(): UseVectorSyncStatusInternalResult {
  const [rawStatus, setRawStatus] = useState<GlobalSyncStatus>(DEFAULT_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentTierRef = useRef<PollTier>("disabled");

  const fetchStatus = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    try {
      const response = await fetch("/api/sync-status");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch sync status");
      }
      const data: GlobalSyncStatus = await response.json();
      setRawStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sync status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Serialize arrays for stable comparison — only changes when content changes
  const activeSyncsKey = JSON.stringify(rawStatus.activeSyncs);
  const pendingSyncsKey = JSON.stringify(rawStatus.pendingSyncs);
  const recentErrorsKey = JSON.stringify(rawStatus.recentErrors);
  const fileWatcherSyncsKey = JSON.stringify(rawStatus.recentFileWatcherSyncs);

  // Memoize status: construct inside memo to avoid returning a stale rawStatus identity
  const foldersKey = JSON.stringify(rawStatus.folders?.map(f => `${f.id}:${f.status}:${f.isWatching}`) ?? []);

  const status = useMemo<GlobalSyncStatus>(() => ({
    isEnabled: rawStatus.isEnabled,
    isSyncing: rawStatus.isSyncing,
    totalFolders: rawStatus.totalFolders,
    totalSyncingOrPending: rawStatus.totalSyncingOrPending,
    foldersComplete: rawStatus.foldersComplete,
    activeSyncs: rawStatus.activeSyncs,
    pendingSyncs: rawStatus.pendingSyncs,
    recentErrors: rawStatus.recentErrors,
    folders: rawStatus.folders ?? [],
    recentFileWatcherSyncs: rawStatus.recentFileWatcherSyncs,
  }), [
    rawStatus.isEnabled,
    rawStatus.isSyncing,
    rawStatus.totalFolders,
    rawStatus.totalSyncingOrPending,
    rawStatus.foldersComplete,
    activeSyncsKey,
    pendingSyncsKey,
    recentErrorsKey,
    foldersKey,
    fileWatcherSyncsKey,
  ]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Derive the current polling tier
  const currentTier = getPollTier(rawStatus);

  // Tier-based polling: timer restarts only when polling tier transitions (active ↔ idle ↔ disabled)
  useEffect(() => {
    currentTierRef.current = currentTier;
    const timer = setInterval(fetchStatus, POLL_INTERVALS[currentTier]);
    return () => clearInterval(timer);
  }, [currentTier, fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refresh: fetchStatus,
  };
}

// Export context for provider
export { VectorSyncContext };
export type { VectorSyncContextType, GlobalSyncStatus, SyncStatusFolder };

