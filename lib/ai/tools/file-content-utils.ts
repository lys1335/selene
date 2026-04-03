/**
 * Shared file content utilities
 *
 * Used by both the read-file tool and the vector search synthesizer.
 */

import { open } from "fs/promises";
import { extname } from "path";

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  md: "markdown",
  json: "json",
  html: "html",
  css: "css",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
};

/**
 * Map a file path to a syntax-highlighting language identifier.
 * Falls back to the bare extension, or "text" when there is none.
 */
export function getCodeLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase().slice(1);
  return LANG_MAP[ext] || ext || "text";
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a file is binary by checking for null bytes in the first 1 KB.
 * Returns `false` if the file cannot be read (let the caller handle errors).
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await open(filePath, "r");
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await fileHandle.read(buffer, 0, 1024, 0);

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await fileHandle?.close();
  }
}

// ---------------------------------------------------------------------------
// Line selection
// ---------------------------------------------------------------------------

interface LineSelectionOptions {
  head?: number;
  tail?: number;
  startLine?: number;
  endLine?: number;
  maxLineCount?: number;
}

interface SelectedLines {
  lines: string[];
  actualStartLine: number;
  actualEndLine: number;
}

/**
 * Apply head/tail/range selection to a line array.
 * `maxLineCount` caps a full-file read (defaults to 5000).
 */
export function selectLines(allLines: string[], options: LineSelectionOptions = {}): SelectedLines {
  const { head, tail, startLine, endLine, maxLineCount = 5000 } = options;

  let selectedLines = allLines;
  let actualStartLine = 1;
  let actualEndLine = allLines.length;

  if (head) {
    actualEndLine = Math.min(allLines.length, head);
    selectedLines = allLines.slice(0, actualEndLine);
  } else if (tail) {
    actualStartLine = Math.max(1, allLines.length - tail + 1);
    selectedLines = allLines.slice(actualStartLine - 1);
  } else if (startLine !== undefined || endLine !== undefined) {
    actualStartLine = Math.max(1, startLine ?? 1);
    actualEndLine = Math.min(allLines.length, endLine ?? allLines.length);
    selectedLines = allLines.slice(actualStartLine - 1, actualEndLine);
  } else if (allLines.length > maxLineCount) {
    selectedLines = allLines.slice(0, maxLineCount);
    actualEndLine = maxLineCount;
  }

  return { lines: selectedLines, actualStartLine, actualEndLine };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format selected lines with leading line numbers, optionally truncating very
 * long individual lines.
 */
export function formatLinesWithNumbers(
  lines: string[],
  startLine: number,
  maxLineWidth?: number,
): string {
  return lines
    .map((line, idx) => {
      const lineNum = `${String(startLine + idx).padStart(4, " ")} | `;
      const body =
        maxLineWidth !== undefined && line.length > maxLineWidth
          ? line.slice(0, maxLineWidth) + "... [truncated]"
          : line;
      return lineNum + body;
    })
    .join("\n");
}
