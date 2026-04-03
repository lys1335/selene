import { NextRequest, NextResponse } from "next/server";
import { updateCharacter, getCharacter } from "@/lib/characters/queries";
import {
  getAvailablePluginsForAgent,
  setPluginEnabledForAgent,
} from "@/lib/plugins/registry";
import { validationErrorResponse } from "@/lib/api/shared-handlers";
import { requireCharacterAuth } from "../_utils";
import { z } from "zod";
import { toStringArray } from "@/lib/utils/array-utils";

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function serializeAssignments(
  assignments: Awaited<ReturnType<typeof getAvailablePluginsForAgent>>
) {
  return assignments.map((entry) => ({
    ...entry.plugin,
    enabledForAgent: entry.enabledForAgent,
  }));
}

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

const updateAgentPluginSchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean(),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireCharacterAuth(request, params);
    if (auth instanceof NextResponse) return auth;
    const { characterId, dbUserId } = auth;

    const assignments = await getAvailablePluginsForAgent(dbUserId, characterId, characterId);

    return NextResponse.json(
      { plugins: serializeAssignments(assignments) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list agent plugins" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireCharacterAuth(request, params);
    if (auth instanceof NextResponse) return auth;
    const { characterId, dbUserId } = auth;

    const body = await request.json();
    const parsed = updateAgentPluginSchema.safeParse(body);
    // validationErrorResponse returns non-null when !success
    if (!parsed.success) return validationErrorResponse(parsed)!;

    const available = await getAvailablePluginsForAgent(dbUserId, characterId, characterId);
    const canAssign = available.some((entry) => entry.plugin.id === parsed.data.pluginId);
    if (!canAssign) {
      return NextResponse.json(
        { error: "Plugin not available for this agent" },
        { status: 400 }
      );
    }

    await setPluginEnabledForAgent(characterId, parsed.data.pluginId, parsed.data.enabled);

    const assignments = await getAvailablePluginsForAgent(dbUserId, characterId, characterId);
    const enabledPluginIds = assignments
      .filter((entry) => entry.enabledForAgent)
      .map((entry) => entry.plugin.id);

    const character = await getCharacter(characterId);
    const existingMetadata = (character?.metadata as Record<string, unknown> | null) ?? {};
    const previousEnabledPluginIds = toStringArray(existingMetadata.enabledPlugins);

    if (!sameStringArray(previousEnabledPluginIds, enabledPluginIds)) {
      await updateCharacter(characterId, {
        metadata: {
          ...existingMetadata,
          enabledPlugins: enabledPluginIds,
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        enabledPluginIds,
        plugins: serializeAssignments(assignments),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update agent plugin" },
      { status: 500 }
    );
  }
}
