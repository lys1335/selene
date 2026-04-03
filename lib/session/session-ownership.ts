import { getSession } from "@/lib/db/queries";

/**
 * Validates that the given session exists and belongs to the given user.
 * Returns `{ session }` on success, or `{ error, status }` on failure.
 */
export async function validateSessionOwnership(sessionId: string, userId: string) {
  const session = await getSession(sessionId);
  if (!session) {
    return { error: "Session not found", status: 404 } as const;
  }
  if (session.userId !== userId) {
    return { error: "Forbidden", status: 403 } as const;
  }
  return { session };
}
