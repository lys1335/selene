/**
 * Parse message metadata from its stored form (string or object) to a plain object.
 * Returns null if parsing fails or the value is not an object.
 */
export function parseMessageMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof metadata === "object" ? metadata as Record<string, unknown> : null;
}
