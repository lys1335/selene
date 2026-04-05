import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/route-auth";
import { getBatchCharacterStats } from "@/lib/characters/queries";

/**
 * GET /api/characters/batch-stats?ids=id1,id2,id3
 *
 * Batch stats fetch. Returns a map of characterId -> stats.
 * Replaces N individual calls to /api/characters/[id]/stats.
 */
export async function GET(req: NextRequest) {
  try {
    const dbUser = await getAuthenticatedUser(req);

    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get("ids") || "";
    const ids = idsParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100);

    if (ids.length === 0) {
      return NextResponse.json({ stats: {} });
    }

    const stats = await getBatchCharacterStats(dbUser.id, ids);
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[Characters API] GET batch-stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get batch character stats" },
      { status: 500 }
    );
  }
}
