/**
 * Shared text extraction for Claude Code tool results.
 *
 * After normalizeToolResultOutput, results arrive in one of these shapes:
 *   1. Raw string (rare – only during streaming before normalization)
 *   2. MCP content array: { content: [{ type: "text", text: "..." }] }
 *   3. Normalized wrapper: { status: "success", content: "the text" }
 *   4. Text field: { text: "..." }
 *   5. Stdout field: { stdout: "..." }
 *
 * Shape (3) was introduced by unwrapMcpTextWrappedToolResult – the MCP array
 * gets unwrapped to a plain string, then normalizeToolResultOutput wraps it
 * as { content: string }.  All Claude Code tool UIs must handle this shape.
 */

/**
 * Strip XML-like status tags from tool result text.
 *
 * Some tool results (e.g., Claude Code Agent SDK's TaskOutput) include
 * XML-style tags like `<retrieval_status>timeout</retrieval_status>` that
 * should not be rendered raw in the UI.
 *
 * - Extracts tag name → inner content as key-value pairs in `statuses`
 * - Returns `cleanText` with the XML tags removed, keeping inner content
 * - If the entire text is a single XML tag, cleanText is just the inner value
 * - Handles multi-line content inside tags and multiple tags
 */
const XML_TAG_REGEX = /<([a-z_][a-z0-9_]*?)>([\s\S]*?)<\/\1>/gi;

export function stripXmlStatusTags(text: string): {
  cleanText: string;
  statuses: Record<string, string>;
} {
  const statuses: Record<string, string> = {};

  // First pass: collect all tag name → content mappings
  let match: RegExpExecArray | null;
  const regex = new RegExp(XML_TAG_REGEX.source, XML_TAG_REGEX.flags);
  while ((match = regex.exec(text)) !== null) {
    const tagName = match[1].toLowerCase();
    const content = match[2].trim();
    statuses[tagName] = content;
  }

  // No XML tags found — return original text unchanged
  if (Object.keys(statuses).length === 0) {
    return { cleanText: text, statuses };
  }

  // Replace each XML tag with its inner content
  let cleanText = text.replace(
    new RegExp(XML_TAG_REGEX.source, XML_TAG_REGEX.flags),
    (_fullMatch, _tagName: string, innerContent: string) => innerContent.trim()
  );

  // Clean up extra whitespace left behind
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText, statuses };
}

/**
 * Extract text from a tool result, stripping any XML status tags.
 * Return type is unchanged for backward compatibility.
 */
export function parseTextResult(result: unknown): string | undefined {
  const raw = extractRawText(result);
  if (raw === undefined) return undefined;
  const { cleanText } = stripXmlStatusTags(raw);
  return cleanText;
}

/**
 * Extract text from a tool result along with any XML status metadata.
 * Use this when the calling component needs access to the status info.
 */
export function parseTextResultWithStatus(result: unknown): {
  text: string | undefined;
  statuses: Record<string, string>;
} {
  const raw = extractRawText(result);
  if (raw === undefined) return { text: undefined, statuses: {} };
  const { cleanText, statuses } = stripXmlStatusTags(raw);
  return { text: cleanText, statuses };
}

/** Internal: extract the raw text string from the various result shapes. */
function extractRawText(result: unknown): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") return result;

  if (typeof result === "object") {
    const r = result as Record<string, unknown>;

    if (Array.isArray(r.content)) {
      // MCP content array: [{ type: "text", text: "..." }, ...]
      const textItem = r.content.find(
        (item: unknown) =>
          item && typeof item === "object" && (item as { type?: string }).type === "text"
      ) as { text?: string } | undefined;
      if (textItem?.text) return textItem.text;
    }

    // Normalized wrapper: { content: "the text" }
    if (typeof r.content === "string") return r.content;

    if (typeof r.text === "string") return r.text;
    if (typeof r.stdout === "string") return r.stdout;
    if (typeof r.message === "string") return r.message;
  }

  return undefined;
}
