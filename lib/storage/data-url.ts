/**
 * Utilities for working with data: URLs (base64-encoded inline content).
 */

/**
 * Parse a data URL into its MIME type and base64 data components.
 * Returns null if the value is not a valid data URL.
 */
export function parseDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}
