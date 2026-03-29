import { NextResponse } from "next/server";
import { runGhostSetup } from "@/lib/ghost-os/setup";

/**
 * POST /api/ghost-os/setup
 * Runs `ghost setup` to configure permissions and install components.
 *
 * Gated to local/Electron environments only — this endpoint executes system
 * commands and must not be exposed to external callers.
 */
export async function POST() {
  // Guard: only allow in Electron/local dev mode.
  // In production cloud deployments, this endpoint should not be reachable.
  const isLocalMode =
    process.env.SELENE_PRODUCTION_BUILD === "1" ||
    process.env.ELECTRON_IS_DEV === "1" ||
    process.env.NODE_ENV !== "production";

  if (!isLocalMode) {
    return NextResponse.json(
      { success: false, stdout: "", stderr: "Ghost OS setup is only available in the desktop app" },
      { status: 403 },
    );
  }

  try {
    const result = await runGhostSetup();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Ghost OS setup failed:", error);
    return NextResponse.json(
      {
        success: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
