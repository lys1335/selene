import type { DesignWorkspaceValidationResult } from "./config";

export interface DesignEditRecord {
  seq: number;
  timestamp: string;
  action: "open" | "generate" | "edit" | "snapshot" | "restore" | "export" | "close" | "install";
  componentId?: string;
  durationMs: number;
  success: boolean;
  validation?: DesignWorkspaceValidationResult;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface DesignWorkspaceHistory {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs?: number;
  actions: DesignEditRecord[];
}

const GLOBAL_KEY = "__selene_design_workspace_history__" as const;
const MAX_HISTORY_ENTRIES = 100;

function getHistoryStore(): Map<string, DesignWorkspaceHistory> {
  const globalRecord = globalThis as unknown as Record<string, Map<string, DesignWorkspaceHistory> | undefined>;
  if (!globalRecord[GLOBAL_KEY]) {
    globalRecord[GLOBAL_KEY] = new Map<string, DesignWorkspaceHistory>();
  }
  return globalRecord[GLOBAL_KEY]!;
}

/** Evict oldest entries if the store exceeds the cap. */
function evictStaleEntries(store: Map<string, DesignWorkspaceHistory>): void {
  if (store.size <= MAX_HISTORY_ENTRIES) return;
  const excess = store.size - MAX_HISTORY_ENTRIES;
  const keys = store.keys();
  for (let i = 0; i < excess; i++) {
    const next = keys.next();
    if (next.done) break;
    store.delete(next.value);
  }
}

export function initDesignHistory(sessionId: string): void {
  const store = getHistoryStore();
  if (store.has(sessionId)) {
    return;
  }

  evictStaleEntries(store);
  store.set(sessionId, {
    sessionId,
    startedAt: new Date().toISOString(),
    actions: [],
  });
}

export function recordDesignHistory(
  sessionId: string,
  record: Omit<DesignEditRecord, "seq" | "timestamp">,
): void {
  const store = getHistoryStore();
  const history = store.get(sessionId);
  if (!history) {
    return;
  }

  history.actions.push({
    ...record,
    seq: history.actions.length + 1,
    timestamp: new Date().toISOString(),
  });
}

export function finalizeDesignHistory(sessionId: string): DesignWorkspaceHistory | null {
  const store = getHistoryStore();
  const history = store.get(sessionId);
  if (!history) {
    return null;
  }

  const endedAt = new Date().toISOString();
  history.endedAt = endedAt;
  history.totalDurationMs =
    new Date(endedAt).getTime() - new Date(history.startedAt).getTime();

  store.delete(sessionId);
  return history;
}

export function peekDesignHistory(sessionId: string): DesignWorkspaceHistory | null {
  const history = getHistoryStore().get(sessionId);
  if (!history) {
    return null;
  }

  return {
    ...history,
    actions: history.actions.map((action) => ({ ...action })),
  };
}
