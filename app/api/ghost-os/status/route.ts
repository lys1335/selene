import { NextResponse } from "next/server";
import { getGhostOsStatus } from "@/lib/ghost-os/setup";

/**
 * GET /api/ghost-os/status
 * Returns Ghost OS installation status, version, permissions, and vision model state.
 */
export async function GET() {
  try {
    const status = await getGhostOsStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[API] Ghost OS status check failed:", error);
    return NextResponse.json(
      {
        installed: false,
        visionModelInstalled: false,
        permissions: {
          accessibility: false,
          screenRecording: false,
          inputMonitoring: false,
        },
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
