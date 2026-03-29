/**
 * Ghost OS Vision Sidecar Management
 *
 * The Ghost OS vision sidecar (ghost-vision) runs ShowUI-2B for tools
 * like ghost_parse_screen and ghost_annotate. ghost_ground auto-starts
 * the sidecar, but ghost_parse_screen and ghost_annotate do not.
 *
 * This module provides a pre-flight check that ensures the sidecar is
 * running before any vision tool call, by calling ghost_ground as a
 * no-op boot trigger if necessary.
 */

import { GHOST_OS_SERVER_NAME } from "./config";

const VISION_SIDECAR_PORT = 9876;
const VISION_SIDECAR_HOST = "127.0.0.1";
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const SIDECAR_BOOT_WAIT_MS = 15000; // max wait for sidecar to become ready
const SIDECAR_POLL_INTERVAL_MS = 1000;

/**
 * Ghost OS tools that require the vision sidecar to be running.
 * ghost_ground auto-starts it, so it's excluded from the pre-flight set.
 */
const VISION_TOOLS_NEEDING_SIDECAR = new Set([
  "ghost_parse_screen",
  "ghost_annotate",
]);

/**
 * Check if a tool name requires the vision sidecar.
 */
export function isVisionSidecarTool(toolName: string): boolean {
  return VISION_TOOLS_NEEDING_SIDECAR.has(toolName);
}

/**
 * Check if the vision sidecar is healthy (responding on its HTTP port).
 */
async function isVisionSidecarRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(
      `http://${VISION_SIDECAR_HOST}:${VISION_SIDECAR_PORT}/health`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for the vision sidecar to become ready, polling its health endpoint.
 * Returns true if sidecar came up within the timeout, false otherwise.
 */
async function waitForSidecar(): Promise<boolean> {
  const deadline = Date.now() + SIDECAR_BOOT_WAIT_MS;

  while (Date.now() < deadline) {
    if (await isVisionSidecarRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, SIDECAR_POLL_INTERVAL_MS));
  }

  return false;
}

/**
 * Ensure the vision sidecar is running before a vision tool call.
 *
 * Strategy: call ghost_ground via the MCP server — ghost_ground auto-starts
 * the sidecar as a side effect. We pass a minimal no-op query that returns
 * quickly. Then we wait for the sidecar health endpoint to respond.
 *
 * @param executeMcpTool - Function to call an MCP tool (injected to avoid circular deps)
 * @returns null if sidecar is ready, or an error message string
 */
export async function ensureVisionSidecar(
  executeMcpTool: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<string | null> {
  // Fast path: sidecar is already running
  if (await isVisionSidecarRunning()) {
    return null;
  }

  console.log("[Ghost OS] Vision sidecar not running. Triggering ghost_ground to auto-start it...");

  try {
    // ghost_ground auto-starts the sidecar. We call it with a minimal query.
    // The query doesn't matter — we just need the sidecar boot side effect.
    await executeMcpTool(GHOST_OS_SERVER_NAME, "ghost_ground", {
      description: "any element",
    });
  } catch (error) {
    console.warn("[Ghost OS] ghost_ground call failed (sidecar may still start):", error);
    // Don't fail yet — the sidecar may still be booting from the attempt
  }

  // Wait for the sidecar to become ready
  const ready = await waitForSidecar();

  if (!ready) {
    return (
      "Vision sidecar failed to start. The ShowUI-2B vision model may not be installed. " +
      "Run `ghost setup --vision` or start manually with `ghost-vision --preload`."
    );
  }

  console.log("[Ghost OS] Vision sidecar is now running.");
  return null;
}
