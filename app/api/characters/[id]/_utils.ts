/**
 * Shared auth + character ownership helper for character API routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { getCharacter } from "@/lib/characters/queries";
import { loadSettings } from "@/lib/settings/settings-manager";

interface CharacterAuthResult {
  characterId: string;
  dbUserId: string;
}

/**
 * Authenticate the request and verify that the caller owns the given character.
 * Returns the resolved characterId and dbUserId on success, or a NextResponse
 * error (401/403/404) that should be returned immediately on failure.
 */
export async function requireCharacterAuth(
  req: NextRequest,
  params: Promise<{ id: string }>
): Promise<CharacterAuthResult | NextResponse> {
  try {
    const userId = await requireAuth(req);
    const settings = loadSettings();
    const dbUser = await getOrCreateLocalUser(userId, settings.localUserEmail);
    const { id: characterId } = await params;

    const character = await getCharacter(characterId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    if (character.userId !== dbUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return { characterId, dbUserId: dbUser.id };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Invalid session")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
