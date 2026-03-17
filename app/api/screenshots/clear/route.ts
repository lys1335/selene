import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function DELETE() {
  try {
    const mediaRoot = path.resolve(process.env.LOCAL_DATA_PATH || ".local-data", "media");
    const screenshotsDir = path.join(mediaRoot, "screenshots");

    let deleted = 0;

    try {
      const entries = await fs.readdir(screenshotsDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(screenshotsDir, entry.name);
        try {
          // Use recursive rm to handle both files and any sub-directories
          await fs.rm(fullPath, { recursive: true, force: true });
          deleted++;
        } catch {
          // Non-fatal: file may be locked or already removed
        }
      }
    } catch (err) {
      // screenshotsDir doesn't exist yet — nothing to delete
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    return NextResponse.json({ deleted });
  } catch (error) {
    console.error("[screenshots/clear] Failed to clear screenshots:", error);
    return NextResponse.json(
      { error: "Failed to clear screenshots" },
      { status: 500 },
    );
  }
}
