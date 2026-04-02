/**
 * POST /api/design/compile-preview
 *
 * Server-side compilation endpoint for React/TSX design components.
 * Called by the preview frame when switching to a Tailwind component
 * that needs server-side compilation (esbuild).
 */

import { NextResponse } from "next/server";
import { buildTailwindPreviewAsync } from "@/lib/design/workspace/compiler";

interface CompilePreviewBody {
  code: string;
  name?: string;
}

export async function POST(request: Request) {
  let body: CompilePreviewBody;

  try {
    body = (await request.json()) as CompilePreviewBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json(
      { error: "Component code is required" },
      { status: 400 }
    );
  }

  try {
    const html = await buildTailwindPreviewAsync(
      code,
      body.name || "Design Component"
    );

    return NextResponse.json({ html });
  } catch (error) {
    // Preserve structured esbuild error details when available
    const message =
      error instanceof Error ? error.message : "Compilation failed";

    const details =
      error instanceof Error && "errors" in error
        ? (error as Error & { errors?: unknown[] }).errors
        : undefined;

    return NextResponse.json(
      { error: message, details },
      { status: 422 }
    );
  }
}
