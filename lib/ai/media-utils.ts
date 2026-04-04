import { readLocalFile, fileExists } from "@/lib/storage/local-storage";

/**
 * Fetch an image from a remote URL and convert it to base64.
 */
export async function urlToBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString("base64");
}

/**
 * Read a local media file and convert to base64.
 * Handles /api/media/... and local-media:// paths.
 */
export function localPathToBase64(imagePath: string): string {
  // Extract relative path from /api/media/... format
  let relativePath = imagePath;
  if (imagePath.startsWith("/api/media/")) {
    relativePath = imagePath.replace("/api/media/", "");
  } else if (imagePath.startsWith("local-media://")) {
    relativePath = imagePath.replace("local-media://", "").replace(/^\/+/, "");
  }

  // Check if file exists
  if (!fileExists(relativePath)) {
    throw new Error(`Local image file not found: ${relativePath}`);
  }

  // Read file and convert to base64
  const buffer = readLocalFile(relativePath);
  return buffer.toString("base64");
}

/**
 * Return true when the path refers to a local media file served via
 * /api/media/... or the local-media:// protocol.
 */
export function isLocalMediaPath(path: string): boolean {
  return path.startsWith("/api/media/") || path.startsWith("local-media://");
}

/**
 * Check if a string looks like valid base64 image data.
 * Strips any data URL prefix before testing.
 */
export function isValidBase64(str: string): boolean {
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  const cleanStr = str.replace(/^data:image\/\w+;base64,/, "");
  if (cleanStr.length < 100) {
    return false;
  }
  return base64Regex.test(cleanStr);
}
