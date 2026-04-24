/**
 * Workspace Metrics
 *
 * Lightweight in-process counters for the workspace tool lifecycle. Exposes
 * aggregate visibility into:
 *   - how many workspace registrations were created/deleted/orphan-cleaned
 *   - the current count of active workspace rows in the DB
 *   - failures during cleanup (silent-failure detection)
 *
 * These counters are intentionally in-memory only — the platform does not
 * currently bundle a metrics backend (StatsD/Prometheus). If we add one later,
 * the recording functions below are the single insertion point.
 *
 * Surface: `getWorkspaceMetricsSnapshot()` returns a plain object suitable for
 * a JSON response at `/api/admin/workspace-metrics` (added in a follow-up).
 */

// ---------------------------------------------------------------------------
// Counter state
// ---------------------------------------------------------------------------

interface CounterState {
  // Lifecycle counts
  created: number;
  deleted: number; // via workspace({action: "delete"})

  // Garbage-collection counts, broken down by trigger
  cleanedBySessionDelete: number;
  cleanedBySessionPurge: number;
  cleanedByCharacterDelete: number;
  cleanedByBootSweep: number;

  // Failure counts
  cleanupErrors: number;

  // Process start (for rate calculations)
  startedAt: string;
}

const state: CounterState = {
  created: 0,
  deleted: 0,
  cleanedBySessionDelete: 0,
  cleanedBySessionPurge: 0,
  cleanedByCharacterDelete: 0,
  cleanedByBootSweep: 0,
  cleanupErrors: 0,
  startedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Recording helpers (called from workspace lifecycle hooks)
// ---------------------------------------------------------------------------

export function recordWorkspaceCreate(): void {
  state.created += 1;
}

export function recordWorkspaceDelete(): void {
  state.deleted += 1;
}

export type CleanupTrigger =
  | "session-delete"
  | "session-purge"
  | "character-delete"
  | "boot-sweep";

export function recordWorkspaceCleanup(trigger: CleanupTrigger): void {
  switch (trigger) {
    case "session-delete":
      state.cleanedBySessionDelete += 1;
      break;
    case "session-purge":
      state.cleanedBySessionPurge += 1;
      break;
    case "character-delete":
      state.cleanedByCharacterDelete += 1;
      break;
    case "boot-sweep":
      state.cleanedByBootSweep += 1;
      break;
  }
}

export function recordWorkspaceCleanupError(): void {
  state.cleanupErrors += 1;
}

// ---------------------------------------------------------------------------
// Snapshot (read-only surface for admin endpoint / health checks)
// ---------------------------------------------------------------------------

export interface WorkspaceMetricsSnapshot {
  counters: {
    created: number;
    deleted: number;
    cleanedBySessionDelete: number;
    cleanedBySessionPurge: number;
    cleanedByCharacterDelete: number;
    cleanedByBootSweep: number;
    cleanupErrors: number;
  };
  /** Current number of `source='workspace'` rows in the DB. */
  activeRows: number;
  /** Count of rows whose folderPath no longer exists on disk. */
  orphanedRows: number;
  /** Histogram of active-row ages in days (bucketed). */
  ageBuckets: {
    lessThan1Day: number;
    oneToSevenDays: number;
    sevenToThirtyDays: number;
    moreThanThirtyDays: number;
  };
  startedAt: string;
  snapshotAt: string;
}

/**
 * Build a snapshot by combining in-memory counters with a fresh DB read for
 * active/orphan counts. Keep this out of hot paths — it runs a couple of
 * SELECTs against `agent_sync_folders`.
 */
export async function getWorkspaceMetricsSnapshot(): Promise<WorkspaceMetricsSnapshot> {
  const { db } = await import("@/lib/db/sqlite-client");
  const { agentSyncFolders } = await import("@/lib/db/sqlite-character-schema");
  const { onlyWorkspaceSource } = await import("@/lib/vectordb/source-predicates");
  const { existsSync } = await import("node:fs");

  const rows = await db
    .select({
      id: agentSyncFolders.id,
      folderPath: agentSyncFolders.folderPath,
      // `agent_sync_folders` has no createdAt column; we proxy with lastSyncedAt
      // (set at row creation for workspace rows via source='workspace' branch).
      lastSyncedAt: agentSyncFolders.lastSyncedAt,
    })
    .from(agentSyncFolders)
    .where(onlyWorkspaceSource());

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let orphaned = 0;
  const ageBuckets = {
    lessThan1Day: 0,
    oneToSevenDays: 0,
    sevenToThirtyDays: 0,
    moreThanThirtyDays: 0,
  };

  for (const row of rows) {
    if (!existsSync(row.folderPath)) orphaned += 1;
    const createdTs = row.lastSyncedAt ? Date.parse(row.lastSyncedAt) : NaN;
    const ageDays = Number.isFinite(createdTs) ? (now - createdTs) / dayMs : 0;
    if (ageDays < 1) ageBuckets.lessThan1Day += 1;
    else if (ageDays < 7) ageBuckets.oneToSevenDays += 1;
    else if (ageDays < 30) ageBuckets.sevenToThirtyDays += 1;
    else ageBuckets.moreThanThirtyDays += 1;
  }

  return {
    counters: {
      created: state.created,
      deleted: state.deleted,
      cleanedBySessionDelete: state.cleanedBySessionDelete,
      cleanedBySessionPurge: state.cleanedBySessionPurge,
      cleanedByCharacterDelete: state.cleanedByCharacterDelete,
      cleanedByBootSweep: state.cleanedByBootSweep,
      cleanupErrors: state.cleanupErrors,
    },
    activeRows: rows.length,
    orphanedRows: orphaned,
    ageBuckets,
    startedAt: state.startedAt,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Test-only reset. Used by unit tests to isolate counter assertions.
 */
export function __resetWorkspaceMetricsForTests(): void {
  state.created = 0;
  state.deleted = 0;
  state.cleanedBySessionDelete = 0;
  state.cleanedBySessionPurge = 0;
  state.cleanedByCharacterDelete = 0;
  state.cleanedByBootSweep = 0;
  state.cleanupErrors = 0;
  state.startedAt = new Date().toISOString();
}
