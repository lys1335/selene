import { NextResponse } from "next/server";
import { runGhostSetup } from "@/lib/ghost-os/setup";

/**
 * POST /api/ghost-os/setup
 * Runs `ghost setup` to configure permissions and install components.
 */
export async function POST() {
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
