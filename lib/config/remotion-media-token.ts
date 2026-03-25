/**
 * Remotion Media Token
 *
 * Used by Remotion's headless browser to authenticate media requests
 * back to the Next.js server via the /api/media endpoint.
 *
 * IMPORTANT: This must match the token the proxy middleware accepts
 * for internal media requests. The proxy checks `internal_auth` query
 * param against `INTERNAL_API_SECRET` (or its default fallback).
 * Using a separate random token causes 401s → ECONNRESET in Remotion.
 */

/**
 * Returns the internal API secret used by both the proxy middleware
 * and Remotion's media requests. This ensures Remotion's headless
 * browser can access /api/media/* without a session cookie.
 */
export function readRemotionMediaToken(): string {
  // Use the same secret the proxy middleware checks (INTERNAL_API_SECRET).
  // This ensures Remotion's ?internal_auth=<token> passes the proxy gate.
  return process.env.INTERNAL_API_SECRET || "selene-internal-scheduler";
}

export const REMOTION_MEDIA_TOKEN = readRemotionMediaToken();
