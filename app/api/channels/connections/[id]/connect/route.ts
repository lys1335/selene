import { NextResponse } from "next/server";
import { resolveAuthUser, resolveChannelOwnership } from "@/lib/api/shared-handlers";
import { getChannelConnection } from "@/lib/db/queries";
import { getChannelManager } from "@/lib/channels/manager";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dbUser = await resolveAuthUser(req);

    const ownershipResult = await resolveChannelOwnership(id, dbUser.id);
    if ("errorResponse" in ownershipResult) {
      return ownershipResult.errorResponse;
    }

    await getChannelManager().connect(id);
    const refreshed = await getChannelConnection(id);

    return NextResponse.json({ connection: refreshed });
  } catch (error) {
    console.error("Connect channel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to connect channel" },
      { status: 500 }
    );
  }
}
