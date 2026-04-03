import { updateToolRun } from "@/lib/db/queries";

/**
 * Returns the current time as an ISO string — used for SQLite timestamp fields.
 */
export const now = (): string => new Date().toISOString();

/**
 * Mark a tool run as failed and return the standard error response object.
 * Extracts the error message from any thrown value.
 */
export async function failToolRun(
  toolRunId: string,
  error: unknown
): Promise<{ status: "error"; error: string }> {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  await updateToolRun(toolRunId, {
    status: "failed",
    error: errorMessage,
    completedAt: now(),
  });
  return { status: "error", error: errorMessage };
}
