/**
 * POST /api/design/compile-preview
 *
 * Server-side compilation endpoint for React/TSX design components.
 * Called by the preview frame when switching to a Tailwind component
 * that needs server-side compilation (esbuild).
 */

import { NextResponse } from "next/server";
import { buildTailwindPreviewAsync } from "@/lib/design/workspace/compiler";
import { requireAuth } from "@/lib/auth/local-auth";

const MAX_PAYLOAD_BYTES = 500 * 1024; // 500KB
const COMPILE_TIMEOUT_MS = 15_000; // 15 seconds

interface CompilePreviewBody {
  code: string;
  name?: string;
}

export async function POST(request: Request) {
  // Authentication check
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Payload size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 }
    );
  }

  let body: CompilePreviewBody;

  try {
    const rawText = await request.text();
    if (rawText.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413 }
      );
    }
    body = JSON.parse(rawText) as CompilePreviewBody;
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
    const compileTask = buildTailwindPreviewAsync(
      code,
      body.name || "Design Component"
    );

    const timeoutTask = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Compilation timed out")), COMPILE_TIMEOUT_MS)
    );

    const html = await Promise.race([compileTask, timeoutTask]);

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
