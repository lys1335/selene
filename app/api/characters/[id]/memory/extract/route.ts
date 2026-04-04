/**
 * Memory Extraction API Route
 *
 * POST - Manually trigger memory extraction for a session
 */

import { NextRequest, NextResponse } from "next/server";
import { manualExtraction } from "@/lib/agent-memory";
import { z } from "zod";
import { requireCharacterOwnership } from "../_utils";

type RouteParams = { params: Promise<{ id: string }> };

// Schema for extraction request
const extractSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
});

// POST - Trigger manual extraction
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireCharacterOwnership(req, params);
    if (auth instanceof NextResponse) return auth;
    const { characterId } = auth;

    const body = await req.json();
    const parseResult = extractSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId } = parseResult.data;

    // Run extraction
    const result = await manualExtraction(characterId, sessionId);

    return NextResponse.json({
      success: true,
      extracted: result.extracted.length,
      skipped: result.skipped,
      memories: result.extracted,
      error: result.error,
    });
  } catch (error) {
    console.error("[Memory API] Extract error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to extract memories" },
      { status: 500 }
    );
  }
}
