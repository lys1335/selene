import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import {
  getOrCreateLocalUser,
  getSessionByCharacterId,
  createSession,
} from "@/lib/db/queries";
import { getCharacter } from "@/lib/characters/queries";
import { loadSettings } from "@/lib/settings/settings-manager";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface ResolveSessionRequest {
  characterId: string;
}

export interface ResolveSessionResponse {
  sessionId: string;
  isNew: boolean;
  title: string;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth(req);
    const settings = loadSettings();
    const dbUser = await getOrCreateLocalUser(userId, settings.localUserEmail);

    const body = await req.json() as Partial<ResolveSessionRequest>;
    const { characterId } = body;

    if (!characterId || typeof characterId !== "string") {
      return NextResponse.json({ error: "characterId is required" }, { status: 400 });
    }

    const character = await getCharacter(characterId);
    if (!character || character.userId !== dbUser.id) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const existingSession = await getSessionByCharacterId(dbUser.id, characterId);

    if (existingSession) {
      const updatedAt = existingSession.updatedAt
        ? new Date(existingSession.updatedAt).getTime()
        : 0;
      const age = Date.now() - updatedAt;

      if (age < TWENTY_FOUR_HOURS_MS) {
        return NextResponse.json({
          sessionId: existingSession.id,
          isNew: false,
          title: existingSession.title ?? `Chat with ${character.name}`,
        } satisfies ResolveSessionResponse);
      }
    }

    // Create a fresh session — either no session existed or the last one is stale
    const newSession = await createSession({
      title: `Chat with ${character.name}`,
      userId: dbUser.id,
      metadata: { characterId, characterName: character.name },
    });

    return NextResponse.json({
      sessionId: newSession.id,
      isNew: true,
      title: newSession.title ?? `Chat with ${character.name}`,
    } satisfies ResolveSessionResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve session";
    if (message === "Unauthorized" || message === "Invalid session") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[Overlay Resolve Session API] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
