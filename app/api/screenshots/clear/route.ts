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
        // Only delete known screenshot files — never recurse into unexpected subdirectories
        if (!entry.isFile() || !/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
          continue;
        }
        const fullPath = path.join(screenshotsDir, entry.name);
        try {
          await fs.unlink(fullPath);
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
