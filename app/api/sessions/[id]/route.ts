import { NextRequest, NextResponse } from "next/server";
import {
  getSessionWithMessages,
  updateSession,
} from "@/lib/db/queries";
import { resolveSessionAuth } from "@/lib/api/shared-handlers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveSessionAuth(req, id);
    if ("errorResponse" in authResult) return authResult.errorResponse;

    const result = await getSessionWithMessages(id);

    if (!result) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    console.log(`[API] Session ${id}: Found ${result.messages.length} messages in DB`);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to get session:", error);
    return NextResponse.json(
      { error: "Failed to get session" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveSessionAuth(req, id);
    if ("errorResponse" in authResult) return authResult.errorResponse;
    const { session } = authResult;

    const body = await req.json();
    const { title, status, metadata } = body as {
      title?: string;
      status?: "active" | "archived" | "deleted";
      metadata?: Record<string, unknown>;
    };

    // Deep-merge metadata so partial updates don't lose existing fields
    const mergedMetadata =
      metadata !== undefined
        ? {
            ...((session.metadata as Record<string, unknown>) ?? {}),
            ...metadata,
          }
        : undefined;

    const updated = await updateSession(id, {
      ...(title !== undefined && { title }),
      ...(status !== undefined && { status }),
      ...(mergedMetadata !== undefined && { metadata: mergedMetadata }),
    });

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error("Failed to update session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveSessionAuth(req, id);
    if ("errorResponse" in authResult) return authResult.errorResponse;

    // Soft delete by setting status to 'deleted'
    await updateSession(id, { status: "deleted" });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
