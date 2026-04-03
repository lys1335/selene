import { db } from "@/lib/db/sqlite-client";
import { scheduledTaskRuns } from "@/lib/db/sqlite-schedule-schema";
import { eq } from "drizzle-orm";

type ScheduledRunWithTask = Awaited<ReturnType<typeof getRunForUser>> & { run: NonNullable<unknown> };

/**
 * Fetch a scheduled run by ID and verify it belongs to the given user.
 * Returns `{ run, task }` on success, or `null` if not found / not owned.
 */
export async function getRunForUser(runId: string, userId: string) {
  const run = await db.query.scheduledTaskRuns.findFirst({
    where: eq(scheduledTaskRuns.id, runId),
    with: { task: true },
  });

  const task = Array.isArray(run?.task) ? run.task[0] : run?.task;
  if (!run || !task || task.userId !== userId) {
    return null;
  }

  return { run, task };
}
