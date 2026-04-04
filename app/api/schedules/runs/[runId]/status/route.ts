/**
 * Scheduled Run Status API
 * GET /api/schedules/runs/[runId]/status
 *
 * Returns the current status for a scheduled task run.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { loadSettings } from "@/lib/settings/settings-manager";
import { getRunForUser } from "@/lib/scheduler/run-lookup";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const userId = await requireAuth(req);
    const settings = loadSettings();
    const dbUser = await getOrCreateLocalUser(userId, settings.localUserEmail);

    const { runId } = await params;

    const runResult = await getRunForUser(runId, dbUser.id);
    if (!runResult) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const { run } = runResult;

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
    });
  } catch (error) {
    console.error("[API] Scheduled run status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch run status" },
      { status: 500 }
    );
  }
}
