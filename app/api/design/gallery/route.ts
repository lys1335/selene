import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import {
  listGalleryComponents,
  getGalleryComponentForUser,
  toggleGalleryFavoriteForUser,
  deleteGalleryComponentForUser,
  markGalleryComponentUsed,
  saveDesignComponentWithPreview,
} from "@/lib/design/gallery";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth(req);
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "save": {
        const name = body.name?.trim();
        const code = body.code?.trim();
        if (!name || !code) {
          return NextResponse.json(
            { success: false, error: "Missing name or code" },
            { status: 400 }
          );
        }
        const saved = await saveDesignComponentWithPreview({
          userId,
          name,
          code,
          prompt: body.prompt?.trim() || name,
          description: body.description?.trim() || undefined,
          mode: body.mode || "html",
          style: body.style || "default",
          framework: body.framework || (body.mode === "tailwind" ? "react-tailwind" : "html-css"),
          category: body.category || "general",
          tags: Array.isArray(body.tags) ? body.tags : [],
          styleTags: Array.isArray(body.styleTags) ? body.styleTags : [],
          sessionId: `design-gallery-${userId}`,
        });
        return NextResponse.json({
          success: true,
          data: { component: saved.component },
        });
      }

      case "search": {
        const components = await listGalleryComponents({
          userId,
          query: body.query || undefined,
          favoritesOnly: body.favoritesOnly === true,
          limit: Math.min(body.limit ?? 60, 100),
        });
        return NextResponse.json({
          success: true,
          data: { components, count: components.length },
        });
      }

      case "get": {
        if (!body.componentId) {
          return NextResponse.json(
            { success: false, error: "Missing componentId" },
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
        if (!body.componentId) {
          return NextResponse.json(
            { success: false, error: "Missing componentId" },
            { status: 400 }
          );
        }
        const component = await toggleGalleryFavoriteForUser(userId, body.componentId);
        return NextResponse.json({ success: true, data: { component } });
      }

      case "reuse": {
        if (!body.componentId) {
          return NextResponse.json(
            { success: false, error: "Missing componentId" },
            { status: 400 }
          );
        }
        const component = await markGalleryComponentUsed(userId, body.componentId);
        return NextResponse.json({ success: true, data: { component } });
      }

      case "delete": {
        if (!body.componentId) {
          return NextResponse.json(
            { success: false, error: "Missing componentId" },
            { status: 400 }
          );
        }
        const deleted = await deleteGalleryComponentForUser(userId, body.componentId);
        return NextResponse.json({ success: true, data: { deleted } });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
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
