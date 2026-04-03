import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { loadSettings } from "@/lib/settings/settings-manager";
import { getSkillById } from "@/lib/skills/queries";
import { renderSkillPrompt } from "@/lib/skills/runtime";
import type { ZodSchema } from "zod";
import type { SkillRecord } from "@/lib/skills/types";
import type { User } from "@/lib/db/sqlite-schema-base";

interface ResolvedSkillRunContext<T> {
  userId: string;
  dbUser: User;
  skill: SkillRecord;
  parsed: T;
  rendered: {
    prompt: string;
    missingParameters: string[];
    resolvedParameters: Record<string, string | number | boolean | null>;
  };
}

type ResolveResult<T> =
  | { ok: true; ctx: ResolvedSkillRunContext<T> }
  | { ok: false; response: NextResponse };

/**
 * Shared auth + validation boilerplate for skill action routes (run, schedule, etc.).
 *
 * Handles: requireAuth → getOrCreateLocalUser → getSkillById (404) →
 *          body parse → schema safeParse (400) → renderSkillPrompt (missing params 400).
 *
 * The `getParams` callback extracts prompt variable arguments from the parsed body
 * so that renderSkillPrompt gets the right input regardless of which schema is used.
 */
export async function resolveSkillRunContext<T>(
  req: NextRequest,
  params: Promise<{ id: string }>,
  schema: ZodSchema<T>,
  getParams: (parsed: T) => Record<string, string | number | boolean | null>,
): Promise<ResolveResult<T>> {
  const userId = await requireAuth(req);
  const settings = loadSettings();
  const dbUser = await getOrCreateLocalUser(userId, settings.localUserEmail);
  const { id } = await params;

  const skill = await getSkillById(id, dbUser.id);
  if (!skill) {
    return { ok: false, response: NextResponse.json({ error: "Skill not found" }, { status: 404 }) };
  }

  const body = await req.json();
  const parsedResult = schema.safeParse(body);
  if (!parsedResult.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid payload", details: parsedResult.error.flatten() },
        { status: 400 },
      ),
    };
  }

  const rendered = renderSkillPrompt(skill, getParams(parsedResult.data));
  if (rendered.missingParameters.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing required parameters", missingParameters: rendered.missingParameters },
        { status: 400 },
      ),
    };
  }

  return { ok: true, ctx: { userId, dbUser, skill, parsed: parsedResult.data, rendered } };
}
