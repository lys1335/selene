/**
 * Resume Schedule API
 * POST /api/schedules/[id]/resume
 *
 * Resumes a paused schedule.
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

    const ownershipResult = await resolveScheduleOwnership(id, dbUser.id);
    if ("errorResponse" in ownershipResult) {
      return ownershipResult.errorResponse;
    }

    // Resume the schedule
    await db.update(scheduledTasks)
      .set({
        enabled: true,
        pausedAt: null,
        pausedUntil: null,
        pauseReason: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduledTasks.id, id));

    // Reload in scheduler
    await getScheduler().reloadSchedule(id);

    return NextResponse.json({
      success: true,
      message: "Schedule resumed",
    });
  } catch (error) {
    console.error("[API] Resume schedule error:", error);
    return NextResponse.json(
      { error: "Failed to resume schedule" },
      { status: 500 }
    );
  }
}
