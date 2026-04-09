import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import {
  exportDesignAsset,
  type DesignExportFormat,
  type DesignExportMode,
} from "@/lib/design/workspace/export";

const VALID_FORMATS = new Set<DesignExportFormat>(["html", "react", "png", "video"]);
function normalizeFormat(value?: string): DesignExportFormat {
  return VALID_FORMATS.has(value as DesignExportFormat)
    ? (value as DesignExportFormat)
    : "html";
}

function normalizeMode(_value?: string): DesignExportMode {
  // All components use Tailwind mode now.
  return "tailwind";
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth(req);
    const body = await req.json();

    const code = body.code?.trim();
    if (!code) {
      return NextResponse.json(
        { success: false, error: "Missing component code" },
        { status: 400 }
      );
    }

    const format = normalizeFormat(body.format);
    const componentName = body.componentName?.trim() || "Design Component";
    const sessionId = `design-export-${userId}`;

    const result = await exportDesignAsset({
      code,
      format,
      componentName,
      sessionId,
      mode: normalizeMode(body.mode),
      width: clampInt(body.width, 1440, 320, 3840),
      height: clampInt(body.height, 900, 200, 2160),
      scale: clampInt(body.scale, 2, 1, 4),
      durationMs: clampInt(body.durationMs, 2400, 500, 10000),
      fps: clampInt(body.fps, 24, 1, 60),
    });

    return NextResponse.json({
      success: true,
      data: {
        format: result.format,
        code: result.code,
        url: result.url,
        fileName: result.fileName,
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
        fps: result.fps,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg === "Unauthorized" || msg === "Invalid session") {
        return NextResponse.json({ success: false, error: msg }, { status: 401 });
      }
    }
    console.error("[design/export]", error);
    return NextResponse.json(
      { success: false, error: "Export failed. Check server logs for details." },
      { status: 500 }
    );
  }
}
