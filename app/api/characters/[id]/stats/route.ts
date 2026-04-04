import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/route-auth";
import { getCharacterStats } from "@/lib/characters/queries";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const dbUser = await getAuthenticatedUser(req);
    const { id } = await params;

    const stats = await getCharacterStats(dbUser.id, id);
    if (!stats) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[Characters API] GET [id]/stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get character stats" },
      { status: 500 }
    );
  }
}
