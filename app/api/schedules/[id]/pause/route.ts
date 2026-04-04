/**
 * Pause Schedule API
 * POST /api/schedules/[id]/pause
 *
 * Pauses a schedule with optional auto-resume time.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuthUser, resolveScheduleOwnership } from "@/lib/api/shared-handlers";
import { db } from "@/lib/db/sqlite-client";
import { scheduledTasks } from "@/lib/db/sqlite-schedule-schema";
import { eq } from "drizzle-orm";
import { getScheduler } from "@/lib/scheduler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const dbUser = await resolveAuthUser(req);
    const { id } = await params;
    const { until, reason } = await req.json().catch(() => ({}));

    const ownershipResult = await resolveScheduleOwnership(id, dbUser.id);
    if ("errorResponse" in ownershipResult) {
      return ownershipResult.errorResponse;
    }

    // Pause the schedule
    await db.update(scheduledTasks)
      .set({
        enabled: false,
        pausedAt: new Date().toISOString(),
        pausedUntil: until || null,
        pauseReason: reason || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduledTasks.id, id));

    // Reload in scheduler
    await getScheduler().reloadSchedule(id);

    return NextResponse.json({
      success: true,
      message: until
        ? `Schedule paused until ${new Date(until).toLocaleString()}`
        : "Schedule paused indefinitely",
    });
  } catch (error) {
    console.error("[API] Pause schedule error:", error);
    return NextResponse.json(
      { error: "Failed to pause schedule" },
      { status: 500 }
    );
  }
}
