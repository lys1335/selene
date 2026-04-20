import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import {
  listGalleryComponents,
  listWorkspaceDesigns,
  listWorkspaceDesignSummaries,
  getGalleryComponentForUser,
  toggleGalleryFavoriteForUser,
  deleteGalleryComponentForUser,
  markGalleryComponentUsed,
  saveDesignComponentRecord,
} from "@/lib/design/gallery";

function isNonEmptyString(val: unknown, maxLen: number): val is string {
  return typeof val === "string" && val.length > 0 && val.length <= maxLen;
}

function sanitizeStringArray(val: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((item): item is string => typeof item === "string" && item.length <= maxItemLen)
    .slice(0, maxItems);
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth(req);
    const body = await req.json();
    const { action } = body;

    if (typeof action !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid action field" },
        { status: 400 }
      );
    }

    switch (action) {
      case "save": {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!name || !code) {
          return NextResponse.json(
            { success: false, error: "Missing name or code" },
            { status: 400 }
          );
        }
        if (name.length > 200) {
          return NextResponse.json(
            { success: false, error: "Name must be 200 characters or fewer" },
            { status: 400 }
          );
        }
        if (code.length > 500_000) {
          return NextResponse.json(
            { success: false, error: "Code must be 500,000 characters or fewer" },
            { status: 400 }
          );
        }
        const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 10_000) : name;
        const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : undefined;
        const mode = "tailwind";
        const style = isNonEmptyString(body.style, 50) ? body.style : "default";
        const framework = isNonEmptyString(body.framework, 50)
          ? body.framework
          : "react-tailwind";
        const category = isNonEmptyString(body.category, 50) ? body.category : "general";
        const tags = sanitizeStringArray(body.tags, 20, 100);
        const styleTags = sanitizeStringArray(body.styleTags, 20, 100);
        const sessionId = isNonEmptyString(body.sessionId, 255) ? body.sessionId : undefined;

        const saved = await saveDesignComponentRecord({
          userId,
          name,
          code,
          prompt: prompt || name,
          description: description || undefined,
          mode,
          style,
          framework,
          category,
          tags,
          styleTags,
          sessionId,
        });
        return NextResponse.json({
          success: true,
          data: { component: saved },
        });
      }

      case "search": {
        const query = typeof body.query === "string" ? body.query.slice(0, 200) : undefined;
        const limit = typeof body.limit === "number" && Number.isFinite(body.limit)
          ? Math.min(Math.max(1, Math.floor(body.limit)), 100)
          : 60;
        const components = await listGalleryComponents({
          userId,
          query: query || undefined,
          favoritesOnly: body.favoritesOnly === true,
          limit,
        });
        return NextResponse.json({
          success: true,
          data: { components, count: components.length },
        });
      }

      case "workspace-list": {
        const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
        const limit = typeof body.limit === "number" && Number.isFinite(body.limit)
          ? Math.min(Math.max(1, Math.floor(body.limit)), 100)
          : 60;
        const sessionId = isNonEmptyString(body.sessionId, 255) ? body.sessionId : undefined;
        const scope = isNonEmptyString(body.scope, 32) ? body.scope : "current";
        const favoritesOnly = body.favoritesOnly === true;
        const components = await listWorkspaceDesigns({
          userId,
          sessionId,
          limit,
        });

        const filtered = components.filter((component) => {
          if (favoritesOnly && !component.isFavorite) return false;
          if (scope === "current" && sessionId && component.sessionId !== sessionId) return false;
          if (scope === "saved" && sessionId && component.sessionId === sessionId) return false;
          if (query) {
            const haystack = `${component.name} ${component.description || ""} ${component.prompt}`.toLowerCase();
            if (!haystack.includes(query.toLowerCase())) return false;
          }
          return true;
        });

        return NextResponse.json({
          success: true,
          data: { components: filtered, count: filtered.length },
        });
      }

      case "workspace-list-summary": {
        // Metadata-only variant of `workspace-list`. Drops `code` + `prompt`
        // from each row so the initial payload stays small regardless of the
        // user's library size. Clients hydrate the full row via `get` when a
        // component is opened.
        const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
        const limit = typeof body.limit === "number" && Number.isFinite(body.limit)
          ? Math.min(Math.max(1, Math.floor(body.limit)), 100)
          : 60;
        const sessionId = isNonEmptyString(body.sessionId, 255) ? body.sessionId : undefined;
        const scope = isNonEmptyString(body.scope, 32) ? body.scope : "current";
        const favoritesOnly = body.favoritesOnly === true;
        const components = await listWorkspaceDesignSummaries({
          userId,
          sessionId,
          limit,
        });

        const filtered = components.filter((component) => {
          if (favoritesOnly && !component.isFavorite) return false;
          if (scope === "current" && sessionId && component.sessionId !== sessionId) return false;
          if (scope === "saved" && sessionId && component.sessionId === sessionId) return false;
          if (query) {
            const haystack = `${component.name} ${component.description || ""}`.toLowerCase();
            if (!haystack.includes(query.toLowerCase())) return false;
          }
          return true;
        });

        return NextResponse.json({
          success: true,
          data: { components: filtered, count: filtered.length },
        });
      }

      case "get": {
        if (!isNonEmptyString(body.componentId, 100)) {
          return NextResponse.json(
            { success: false, error: "Missing or invalid componentId" },
            { status: 400 }
          );
        }
        const component = await getGalleryComponentForUser(userId, body.componentId);
        if (!component) {
          return NextResponse.json(
            { success: false, error: "Component not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true, data: { component } });
      }

      case "favorite": {
        if (!isNonEmptyString(body.componentId, 100)) {
          return NextResponse.json(
            { success: false, error: "Missing or invalid componentId" },
            { status: 400 }
          );
        }
        const component = await toggleGalleryFavoriteForUser(userId, body.componentId);
        if (!component) {
          return NextResponse.json(
            { success: false, error: "Component not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true, data: { component } });
      }

      case "reuse": {
        if (!isNonEmptyString(body.componentId, 100)) {
          return NextResponse.json(
            { success: false, error: "Missing or invalid componentId" },
            { status: 400 }
          );
        }
        const component = await markGalleryComponentUsed(userId, body.componentId);
        if (!component) {
          return NextResponse.json(
            { success: false, error: "Component not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true, data: { component } });
      }

      case "delete": {
        if (!isNonEmptyString(body.componentId, 100)) {
          return NextResponse.json(
            { success: false, error: "Missing or invalid componentId" },
            { status: 400 }
          );
        }
        const deleted = await deleteGalleryComponentForUser(userId, body.componentId);
        if (!deleted) {
          return NextResponse.json(
            { success: false, error: "Component not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true, data: { deleted } });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${String(action).slice(0, 50)}` },
          { status: 400 }
        );
    }
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg === "Unauthorized" || msg === "Invalid session") {
        return NextResponse.json({ success: false, error: msg }, { status: 401 });
      }
    }
    console.error("[design/gallery]", error);
    return NextResponse.json(
      { success: false, error: "Gallery operation failed. Check server logs for details." },
      { status: 500 }
    );
  }
}
