import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { loadSettings } from "@/lib/settings/settings-manager";

/**
 * Authenticates a request and resolves the local database user in one step.
 * Throws if the request is not authenticated (same behaviour as `requireAuth`).
 */
export async function getAuthenticatedUser(req: NextRequest) {
  const userId = await requireAuth(req);
  const settings = loadSettings();
  const dbUser = await getOrCreateLocalUser(userId, settings.localUserEmail);
  return dbUser;
}
