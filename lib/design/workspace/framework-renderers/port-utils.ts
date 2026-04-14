/**
 * Shared port allocation utility for framework renderers.
 *
 * Consolidates the duplicated findAvailablePort logic from Vite, PHP,
 * and InspectorProxy renderers into a single implementation.
 */

import net from "net";

/**
 * Find an available TCP port by probing a range.
 *
 * Uses a listen-then-close strategy to detect port availability.
 * While this has a TOCTOU window, callers that spawn processes on
 * the found port should handle EADDRINUSE by retrying (see
 * ViteRenderer/PHPRenderer startup retry loops).
 */
export async function findAvailablePort(min: number, max: number): Promise<number> {
  for (let port = min; port <= max; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
      server.on("error", () => resolve(false));
    });
    if (available) return port;
  }

  throw new Error(`No available ports in range ${min}-${max}`);
}
