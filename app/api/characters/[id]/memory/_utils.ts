/**
 * Shared helpers for the character memory API routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { getCharacter } from "@/lib/characters/queries";
import { loadSettings } from "@/lib/settings/settings-manager";

interface AuthAndCharacterResult {
  characterId: string;
  dbUserId: string;
}

/**
 * Authenticate the request and verify that the caller owns the given character.
 * Returns the resolved characterId and dbUserId on success, or a NextResponse
 * error (400/403/404/500) that should be returned immediately on failure.
 */
export async function requireCharacterOwnership(
  req: NextRequest,
  params: Promise<{ id: string }>
): Promise<AuthAndCharacterResult | NextResponse> {
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
}
