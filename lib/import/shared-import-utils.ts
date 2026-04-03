import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import { getOrCreateLocalUser } from "@/lib/db/queries";
import { loadSettings } from "@/lib/settings/settings-manager";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

interface AuthenticatedUser {
  authUserId: string;
  dbUser: { id: string; email: string | null };
}

/**
 * Authenticate the request and resolve the local DB user.
 * Returns a NextResponse on failure so the caller can return early,
 * or the resolved user data on success.
 */
export async function resolveImportAuthUser(
  request: NextRequest,
): Promise<AuthenticatedUser | NextResponse> {
  try {
    const authUserId = await requireAuth(request);
    const settings = loadSettings();
    const dbUser = await getOrCreateLocalUser(authUserId, settings.localUserEmail);
    return { authUserId, dbUser };
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

// ---------------------------------------------------------------------------
// File validation helpers
// ---------------------------------------------------------------------------

const SINGLE_FILE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Validate that a single uploaded file is within the size limit and has an
 * accepted extension (.zip or .md).
 * Returns a NextResponse error if invalid, or null if valid.
 */
export function validateSingleImportFile(
  file: File | null | undefined,
): NextResponse | null {
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".zip") && !lowerName.endsWith(".md")) {
    return NextResponse.json(
      { error: "Only .zip packages or .md files are supported" },
      { status: 400 },
    );
  }

  if (file.size > SINGLE_FILE_MAX_BYTES) {
    return NextResponse.json(
      { error: "File size exceeds 50MB limit" },
      { status: 400 },
    );
  }

  return null;
}

/**
 * Validate a batch of uploaded files (multi-file plugin import).
 * Returns a NextResponse error if invalid, or null if valid.
 */
export function validateMultiImportFiles(files: File[]): NextResponse | null {
  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  if (files.some((f) => f.size > SINGLE_FILE_MAX_BYTES)) {
    return NextResponse.json(
      { error: "One or more files exceed the 50MB per-file limit" },
      { status: 400 },
    );
  }

  if (totalSize > 150 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Total upload size exceeds 150MB limit" },
      { status: 400 },
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

/**
 * Build a generic 500 error response for import routes, with the standard
 * Unauthorized short-circuit.
 */
export function importErrorResponse(
  error: unknown,
  fallbackMessage = "Import failed",
): NextResponse {
  if (
    error instanceof Error &&
    (error.message === "Unauthorized" || error.message === "Invalid session")
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallbackMessage },
    { status: 500 },
  );
}
