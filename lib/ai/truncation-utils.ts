/**
 * Shared Truncation Utilities
 *
 * Provides unified formatting for truncation markers across all tools.
 */

export type TruncationIdType = "logId" | "contentId";

// ============================================================================
// Middle Truncation (Head + Tail)
// ============================================================================

export interface MiddleTruncateResult {
  content: string;
  truncated: boolean;
  originalLength: number;
}

/**
 * Truncate text by keeping head and tail, removing the middle.
 * This preserves the beginning (setup, context) and end (results, errors, exit status)
 * of command output, which is far more useful than head-only truncation.
 */
export function middleTruncateText(text: string, maxChars: number): MiddleTruncateResult {
  if (!text || text.length <= maxChars) {
    return { content: text || "", truncated: false, originalLength: text?.length ?? 0 };
  }

  // Reserve space for the truncation marker line
  const markerReserve = 120;
  const availableChars = Math.max(200, maxChars - markerReserve);

  const headChars = Math.ceil(availableChars / 2);
  const tailChars = availableChars - headChars;

  // Snap to line boundaries to avoid cutting mid-line
  const headEnd = text.lastIndexOf("\n", headChars);
  const tailStart = tailChars > 0 ? text.indexOf("\n", text.length - tailChars) : text.length;

  const actualHeadEnd = headEnd > 0 ? headEnd : headChars;
  const actualTailStart = tailStart >= 0 && tailStart < text.length ? tailStart + 1 : text.length - tailChars;

  const head = text.slice(0, actualHeadEnd);
  const tail = actualTailStart < text.length ? text.slice(actualTailStart) : "";

  const omittedChars = text.length - head.length - tail.length;
  // Estimate omitted lines (avg ~80 chars/line for terminal output)
  const estimatedOmittedLines = Math.max(1, Math.round(omittedChars / 80));

  const marker = `\n\n... [TRUNCATED ~${estimatedOmittedLines.toLocaleString()} LINES / ${omittedChars.toLocaleString()} CHARS — showing head + tail] ...\n\n`;

  return {
    content: head + marker + tail,
    truncated: true,
    originalLength: text.length,
  };
}

export interface TruncationMarkerParams {
  originalLength: number;
  truncatedLength: number;
  estimatedTokens: number;
  maxTokens: number;
  /** Optional ID for retrieval. If omitted or "unknown", no retrieval instructions are shown. */
  id?: string;
  idType: TruncationIdType;
}

/**
 * Generate a consistent, high-visibility truncation marker for AI context.
 */
export function generateTruncationMarker(params: TruncationMarkerParams): string {
  const {
    originalLength,
    truncatedLength,
    estimatedTokens,
    maxTokens,
    id,
    idType,
  } = params;

  // Only show retrieval instructions if we have a valid ID
  const hasValidId = id && id !== "unknown";
  
  const retrievalSection = hasValidId
    ? `📦 FULL OUTPUT AVAILABLE
   Reference ID: ${id}

🔧 TO RETRIEVE FULL OUTPUT:
   ${idType === "logId" 
     ? `executeCommand({ command: "readLog", logId: "${id}" })` 
     : `retrieveFullContent({ contentId: "${id}" })`}

💡 RECOMMENDATION:
   Only retrieve full output if the truncated portion above is
   insufficient for your task. Consider using grep/filtering
   commands to get specific information instead.`
    : `⚠️  FULL OUTPUT NOT STORED
   No session context available for storage.
   
💡 TIP:
   Re-run the command with proper session context if you need
   the complete output, or use filtering commands (grep, head, tail)
   to reduce output size.`;

  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  OUTPUT TRUNCATED TO PREVENT CONTEXT OVERFLOW

Original: ~${estimatedTokens.toLocaleString()} tokens (${originalLength.toLocaleString()} chars)
Showing: ~${maxTokens.toLocaleString()} tokens (${truncatedLength.toLocaleString()} chars)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${retrievalSection}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}
