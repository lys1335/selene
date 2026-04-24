/**
 * Workspace Metrics API
 *
 * GET /api/admin/workspace-metrics
 *
 * Returns lifecycle counters + live DB state for workspace-tool registrations.
 * Use this endpoint to detect silent drift:
 *   - `orphanedRows > 0` means the worktree directory was removed out-of-band
 *     but the DB row still points at it. The boot sweep will clean these up
 *     on next process start; a non-zero count here between boots indicates
 *     we should investigate what's deleting worktrees externally.
 *   - `cleanupErrors > 0` means at least one cleanup path failed (logged but
 *     swallowed). Should be watched — persistent errors break the event-driven
 *     contract and push the load back to the boot sweep.
 *   - `ageBuckets.moreThanThirtyDays > 0` means workspace rows are surviving
 *     past the 30-day session purge. Either agents are long-lived with active
 *     workspaces (fine) or sessions were reactivated after soft-delete (fine),
 *     but sustained growth signals a leak.
 *
 * Runs only in local environments — mirrors `/api/admin/analytics`.
 */

import { NextResponse } from "next/server";
import { isLocalEnvironment } from "@/lib/utils/environment";
import { getWorkspaceMetricsSnapshot } from "@/lib/workspace/metrics";

export async function GET() {
  if (!isLocalEnvironment()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await getWorkspaceMetricsSnapshot();

    // Invariant checks — surface obvious drift in the response so a simple
    // dashboard or healthcheck can assert on them without re-deriving.
    const invariants = {
      hasOrphans: snapshot.orphanedRows > 0,
      hasErrors: snapshot.counters.cleanupErrors > 0,
      hasVeryOldRows: snapshot.ageBuckets.moreThanThirtyDays > 0,
      // Rough reconciliation: created should be >= deleted + all cleanup paths
      // (some pre-existing rows may have been present at boot so this is a
      // lower bound, not an equality).
      suspiciousLifecycleMismatch:
        snapshot.counters.created <
        snapshot.counters.deleted +
          snapshot.counters.cleanedBySessionDelete +
          snapshot.counters.cleanedBySessionPurge +
          snapshot.counters.cleanedByCharacterDelete +
          snapshot.counters.cleanedByBootSweep,
    };

    return NextResponse.json({ ...snapshot, invariants });
  } catch (error) {
    console.error("[workspace-metrics] Failed to build snapshot:", error);
    return NextResponse.json(
      { error: "Failed to build workspace metrics snapshot" },
      { status: 500 },
    );
  }
}
