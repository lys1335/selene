/**
 * AI response parsing and inline-edit application utilities.
 * Extracted from Otter Cards actions-streaming.ts and actions.ts.
 *
 * All functions are pure -- no side effects, no external dependencies.
 */

import { repairInlineEditJSX } from './jsx';


/** Result of parsing an AI response that may contain code + description */
export interface ParsedAIResponse {
  /** The extracted code (HTML or JSX) */
  code: string;
  /** Detected language of the code block */
  language: 'html' | 'jsx';
  /** Any non-code prose the model emitted before/after the code */
  description?: string;
}

/**
 * Parse an AI response string to separate code from surrounding prose.
 *
 * Detection strategy (in priority order):
 * 1. If the response contains `import` or `export default function`, treat it
 *    as JSX/React and locate the code boundary via known start patterns.
 * 2. Otherwise look for the outermost `<div>...</div>` block and treat it as
 *    HTML.
 * 3. If neither heuristic matches, return the entire response as HTML.
 */
export function parseAIResponse(response: string): ParsedAIResponse {
  // JSX / React component detection
  if (response.includes('import ') || response.includes('export default function')) {
    const codeStartPatterns: RegExp[] = [
      /^import\s+/m,
      /^export\s+default\s+function/m,
      /^<[A-Z]/m,   // JSX element starting with uppercase
      /^<div/m,     // JSX starting with <div
    ];

    let codeStartIndex = -1;
    for (const pattern of codeStartPatterns) {
      const match = response.match(pattern);
      if (match && match.index !== undefined) {
        codeStartIndex = match.index;
        break;
      }
    }

    if (codeStartIndex > 0) {
      const description = response.substring(0, codeStartIndex).trim();
      const code = response.substring(codeStartIndex).trim();
      return { code, language: 'jsx', description: description || undefined };
    }

    return { code: response, language: 'jsx' };
  }

  // HTML block detection -- find the full document fragment
  // Match the first opening HTML tag and the last closing HTML tag to capture
  // <style> blocks, <div> blocks, and any other HTML elements.
  const firstTagMatch = response.match(/<(?:style|div|section|article|header|main|nav|aside|footer|table|ul|ol|p|h[1-6])\b/i);
  const lastCloseMatch = response.match(/[\s\S]*<\/(?:style|div|section|article|header|main|nav|aside|footer|table|ul|ol|p|h[1-6])>/i);

  if (firstTagMatch && lastCloseMatch && firstTagMatch.index !== undefined) {
    const startIndex = firstTagMatch.index;
    const endIndex = (lastCloseMatch.index ?? 0) + lastCloseMatch[0].length;
    const code = response.substring(startIndex, endIndex).trim();
    const beforeHtml = response.substring(0, startIndex).trim();
    const afterHtml = response.substring(endIndex).trim();
    const description = (beforeHtml + '\n\n' + afterHtml).trim();

    return {
      code,
      language: 'html',
      description: description || undefined,
    };
  }

  // Fallback: treat the entire response as HTML
  return { code: response, language: 'html' };
}

/** A single line-range edit parsed from the @lines N-M / @end format */
interface LineEdit {
  /** 0-based start line */
  start: number;
  /** 0-based end line (inclusive) */
  end: number;
  /** Replacement content */
  content: string;
}

/**
 * Apply inline edits to source code.
 *
 * Edit format (produced by the AI):
 * ```
 * @lines 5-10
 * <replacement content>
 * @end
 * ```
 *
 * Line numbers in the format are 1-based and inclusive on both ends.
 *
 * Algorithm:
 * 1. Parse all `@lines N-M ... @end` blocks from `editResponse`.
 * 2. Sort edits in reverse line order so earlier splices don't shift indices
 *    of later edits.
 * 3. Splice replacement lines into the original source.
 * 4. Run `repairInlineEditJSX` on the combined result to fix any structural
 *    issues introduced by merging chunks.
 */
export function applyInlineEdits(originalCode: string, editResponse: string): string {
  const lines = originalCode.split('\n');

  // Parse all edit blocks using the @lines N-M ... @end format
  const editPattern = /@lines\s+(\d+)-(\d+)\s*\n([\s\S]*?)@end/g;
  let match: RegExpExecArray | null;
  const edits: LineEdit[] = [];

  while ((match = editPattern.exec(editResponse)) !== null) {
    const start = parseInt(match[1], 10) - 1; // convert to 0-based
    const end = parseInt(match[2], 10) - 1;
    const content = match[3].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    edits.push({ start, end, content });
  }

  // Validate parsed edit blocks
  if (edits.length === 0) {
    throw new Error('No inline edit blocks found in AI response');
  }

  const lineCount = lines.length;
  for (const edit of edits) {
    // Line numbers were converted to 0-based; convert back for error messages
    const displayStart = edit.start + 1;
    const displayEnd = edit.end + 1;

    if (edit.start > edit.end) {
      throw new Error(`Invalid line range: @lines ${displayStart}-${displayEnd}`);
    }
    if (edit.end >= lineCount) {
      throw new Error(
        `Line range @lines ${displayStart}-${displayEnd} exceeds code length (${lineCount} lines)`,
      );
    }
  }

  // Sort in ascending order to check for overlaps, then reverse for splicing
  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start <= edits[i - 1].end) {
      throw new Error('Overlapping edit ranges detected');
    }
  }

  // Reverse so splicing doesn't invalidate subsequent indices
  edits.reverse();

  // Apply each edit by replacing the target line range
  for (const edit of edits) {
    const newLines = edit.content.split('\n');
    lines.splice(edit.start, edit.end - edit.start + 1, ...newLines);
  }

  const patched = lines.join('\n');

  // Run repairInlineEditJSX to fix structural issues introduced by merging chunks
  return repairInlineEditJSX(patched);
}
