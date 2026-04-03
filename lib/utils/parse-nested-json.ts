/** Type for a content array item that carries text. */
export interface TextContentItem {
  type?: string;
  text?: string;
}

/**
 * Finds the first item in a content array that has `type === "text"` and a string `text` field.
 * This predicate is shared between tool result normalization utilities.
 */
export function findTextContentItem(
  content: unknown[],
): TextContentItem | undefined {
  return content.find(
    (item): item is TextContentItem =>
      !!item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );
}

export function parseNestedJsonString(value: string, maxDepth: number = 3): unknown | undefined {
  let current: unknown = value;
  for (let i = 0; i < maxDepth; i += 1) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed) return undefined;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return i === 0 ? undefined : current;
    }
  }
  return current;
}
