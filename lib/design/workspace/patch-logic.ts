/**
 * Design Workspace Patch Logic
 *
 * Implements fuzzy match & patch for design workspace edits,
 * ported from the filesystem edit-logic.ts but adapted for
 * in-memory JSX/TSX source code patching.
 *
 * Key capabilities:
 * - Exact string matching (primary)
 * - Fuzzy line-by-line matching with indentation re-alignment (fallback)
 * - Whitespace normalization (tabs/spaces, 2 vs 4 indent)
 * - Sequential patch application with bottom-up offset tracking
 * - Improved JSX balance validation (handles fragments, generics)
 * - Better error messages with closest-match hints
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatchOp {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface PatchResult {
  success: boolean;
  code: string;
  totalReplacements: number;
  error?: string;
  /** Hint for the LLM to self-correct on retry. */
  hint?: string;
  /** When fuzzy matching was used, indicates which patches needed it. */
  fuzzyMatched?: number[];
}

export interface JsxValidationResult {
  valid: boolean;
  /** Name of the first unclosed tag, if any. */
  unclosedTag?: string;
  /** Whether the check is authoritative or heuristic. */
  confidence: "high" | "heuristic";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize line endings to \n.
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Get the leading whitespace of a line.
 */
function getIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * Normalize indentation style: convert tabs to spaces (2-space default).
 */
function normalizeIndentation(text: string): string {
  return text.replace(/\t/g, "  ");
}

// ---------------------------------------------------------------------------
// Fuzzy Matching (ported from lib/ai/filesystem/edit-logic.ts)
// ---------------------------------------------------------------------------

interface FuzzyMatch {
  index: number;
  /** Number of lines in the matched block. */
  length: number;
}

/**
 * Find a block of lines in `contentLines` where the trimmed versions match
 * the trimmed `searchLines`. Returns all match positions.
 */
function findFuzzyMatches(
  contentLines: string[],
  searchLines: string[],
): FuzzyMatch[] {
  const matches: FuzzyMatch[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let isMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j].trim()) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      matches.push({ index: i, length: searchLines.length });
    }
  }

  return matches;
}

/**
 * Re-indent `newString` lines to match the indentation of the original
 * matched block in the file.
 */
function reindentNewString(
  newString: string,
  originalFirstLineIndent: string,
): string[] {
  const newLines = newString.split("\n");
  if (newLines.length === 0) return newLines;

  const baseIndentNew = getIndentation(newLines[0]);

  return newLines.map((line) => {
    if (line.startsWith(baseIndentNew)) {
      return originalFirstLineIndent + line.slice(baseIndentNew.length);
    }
    // Line is less indented than base — apply original indent + trimmed
    return originalFirstLineIndent + line.trimStart();
  });
}

// ---------------------------------------------------------------------------
// Single Patch Application
// ---------------------------------------------------------------------------

interface SinglePatchResult {
  success: boolean;
  code: string;
  replacements: number;
  fuzzy: boolean;
  error?: string;
  hint?: string;
}

/**
 * Apply a single oldString->newString patch to the source code.
 * Tries exact match first, then falls back to fuzzy line-by-line matching.
 */
function applySinglePatch(
  code: string,
  op: PatchOp,
): SinglePatchResult {
  const normalizedCode = normalizeLineEndings(code);
  const normalizedOld = normalizeLineEndings(op.oldString);
  const normalizedNew = normalizeLineEndings(op.newString);

  // 1. Exact match
  const exactOccurrences = normalizedCode.split(normalizedOld).length - 1;

  if (exactOccurrences > 0) {
    if (exactOccurrences > 1 && !op.replaceAll) {
      return {
        success: false,
        code,
        replacements: 0,
        fuzzy: false,
        error: `"oldString" found ${exactOccurrences} times. Set "replaceAll: true" to replace all, or provide a longer/more unique "oldString".`,
      };
    }

    const patched = op.replaceAll
      ? normalizedCode.split(normalizedOld).join(normalizedNew)
      : normalizedCode.replace(normalizedOld, normalizedNew);

    return {
      success: true,
      code: patched,
      replacements: op.replaceAll ? exactOccurrences : 1,
      fuzzy: false,
    };
  }

  // 2. Fuzzy match (line-by-line, ignoring indentation)
  const contentLines = normalizeIndentation(normalizedCode).split("\n");
  const searchLines = normalizeIndentation(normalizedOld).split("\n");
  const matches = findFuzzyMatches(contentLines, searchLines);

  if (matches.length === 0) {
    // Build a hint showing the closest partial match
    const hint = buildClosestMatchHint(normalizedCode, normalizedOld);
    return {
      success: false,
      code,
      replacements: 0,
      fuzzy: false,
      error: `"oldString" not found in design source (tried exact match and fuzzy line match).`,
      hint,
    };
  }

  if (matches.length > 1 && !op.replaceAll) {
    return {
      success: false,
      code,
      replacements: 0,
      fuzzy: true,
      error: `"oldString" found ${matches.length} times using fuzzy matching. Provide more context or set "replaceAll: true".`,
    };
  }

  // Apply fuzzy replacement(s) — process from bottom to top to preserve line indices
  const originalCodeLines = normalizedCode.split("\n");
  const matchesToApply = op.replaceAll ? [...matches].reverse() : [matches[0]];
  let replacements = 0;

  for (const match of matchesToApply) {
    const originalIndent = getIndentation(originalCodeLines[match.index]);
    const reindentedLines = reindentNewString(normalizedNew, originalIndent);
    originalCodeLines.splice(match.index, match.length, ...reindentedLines);
    replacements++;
  }

  return {
    success: true,
    code: originalCodeLines.join("\n"),
    replacements,
    fuzzy: true,
  };
}

// ---------------------------------------------------------------------------
// Multi-Patch Application
// ---------------------------------------------------------------------------

/**
 * Apply an array of patches sequentially to source code.
 * Each patch sees the result of the previous one.
 */
export function applyPatches(
  sourceCode: string,
  patches: PatchOp[],
): PatchResult {
  let code = sourceCode;
  let totalReplacements = 0;
  const fuzzyMatched: number[] = [];

  for (let i = 0; i < patches.length; i++) {
    const result = applySinglePatch(code, patches[i]);

    if (!result.success) {
      const patchLabel = patches.length > 1 ? ` (patches[${i}])` : "";
      const priorNote =
        i > 0
          ? ` Note: ${i} prior patch(es) were already applied — use "readSource" to see the current state.`
          : "";

      return {
        success: false,
        code: sourceCode,
        totalReplacements,
        error: `${result.error}${patchLabel}${priorNote}`,
        hint: result.hint,
      };
    }

    code = result.code;
    totalReplacements += result.replacements;
    if (result.fuzzy) {
      fuzzyMatched.push(i);
    }
  }

  return {
    success: true,
    code,
    totalReplacements,
    fuzzyMatched: fuzzyMatched.length > 0 ? fuzzyMatched : undefined,
  };
}

// ---------------------------------------------------------------------------
// JSX Balance Validation
// ---------------------------------------------------------------------------

/**
 * Lightweight JSX tag-balance check. Counts self-closing and open/close tags
 * and returns validation info.
 *
 * Improvements over the original:
 * - Handles JSX fragments (<>...</>)
 * - Better generic type stripping (Record<K, V>, FC<Props>, etc.)
 * - Handles conditional/ternary JSX patterns more gracefully
 * - Strips JSX expression containers {...} content that might contain generics
 */
export function validateJsxBalance(code: string): JsxValidationResult {
  // Strip string literals and comments to avoid false positives
  let stripped = code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  // Strip TypeScript generics that look like JSX tags
  // Pattern 1: function/method call with generic — useState<Type>(...), useRef<El>(...)
  stripped = stripped.replace(
    /\b\w+<([A-Z][A-Za-z0-9.,\s|&\[\]<>]*)>(?=\s*[(\],;:=&|)])/g,
    (match) => " ".repeat(match.length),
  );

  // Pattern 2: Type annotations — `: Type<Generic>`, `as Type<Generic>`
  stripped = stripped.replace(
    /(?::\s*|as\s+)([A-Z][A-Za-z0-9.]*(?:<[^>]*>)?)/g,
    (match) => " ".repeat(match.length),
  );

  // Pattern 3: Type parameters in function/interface declarations
  // e.g., `function foo<T extends Bar>`, `interface Foo<T>`
  stripped = stripped.replace(
    /(?:function|interface|type|class)\s+\w+\s*<[^>]*>/g,
    (match) => " ".repeat(match.length),
  );

  // Pattern 4: Generic type expressions like `Record<string, FC<Props>>`, `Array<Element>`
  // Nested generics: keep stripping inner to outer
  let prevStripped = "";
  while (prevStripped !== stripped) {
    prevStripped = stripped;
    stripped = stripped.replace(
      /\b([A-Z][A-Za-z0-9.]*)<([A-Za-z0-9.,\s|&\[\]"'()=>?:]*?)>/g,
      (match, name) => {
        // If this looks like it could be JSX (followed by newline, JSX content, etc.), skip
        // But if it's in a type position, strip it
        return " ".repeat(match.length);
      },
    );
  }

  // Handle JSX fragments: <> and </>
  // Count them separately — they must balance
  const fragmentOpens = (stripped.match(/<>(?!\s*=)/g) || []).length;
  const fragmentCloses = (stripped.match(/<\/>/g) || []).length;

  // Match JSX component tags: <Tag, </Tag, or self-closing />
  const tagPattern = /<\/?([A-Z][A-Za-z0-9.]*)[^>]*?\/?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(stripped)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];

    if (fullMatch.endsWith("/>")) {
      // Self-closing — no effect on balance
      continue;
    }

    if (fullMatch.startsWith("</")) {
      // Closing tag
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      }
      // Mismatched close — skip (could be conditional JSX)
    } else {
      // Opening tag
      stack.push(tagName);
    }
  }

  // Check both component tags and fragments
  const hasUnbalancedFragments = fragmentOpens !== fragmentCloses;
  const hasUnbalancedTags = stack.length > 0;

  if (!hasUnbalancedTags && !hasUnbalancedFragments) {
    return { valid: true, confidence: "heuristic" };
  }

  return {
    valid: false,
    unclosedTag: hasUnbalancedTags ? stack[stack.length - 1] : "<>",
    confidence: "heuristic",
  };
}

/**
 * Legacy wrapper — returns the unclosed tag name or null.
 * Used by the existing test suite and handlePatch.
 */
export function findUnclosedJsxTag(code: string): string | null {
  const result = validateJsxBalance(code);
  return result.valid ? null : (result.unclosedTag ?? null);
}

// ---------------------------------------------------------------------------
// Error Hint Builder
// ---------------------------------------------------------------------------

/**
 * Build a hint showing the closest partial match to help the LLM self-correct.
 * Searches for the longest matching prefix of oldString lines in the source.
 */
function buildClosestMatchHint(source: string, oldString: string): string {
  const sourceLines = source.split("\n");
  const searchLines = oldString.split("\n");

  if (searchLines.length === 0) return "";

  // Find the first line of oldString in the source (trimmed match)
  const firstSearchTrimmed = searchLines[0].trim();
  if (!firstSearchTrimmed) return "";

  let bestMatchStart = -1;
  let bestMatchLength = 0;

  for (let i = 0; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === firstSearchTrimmed) {
      // Count how many consecutive lines match (trimmed)
      let matchLen = 1;
      for (let j = 1; j < searchLines.length && i + j < sourceLines.length; j++) {
        if (sourceLines[i + j].trim() === searchLines[j].trim()) {
          matchLen++;
        } else {
          break;
        }
      }
      if (matchLen > bestMatchLength) {
        bestMatchLength = matchLen;
        bestMatchStart = i;
      }
    }
  }

  if (bestMatchStart === -1) {
    // No line matches at all — show first 3 lines of oldString for context
    const preview = searchLines.slice(0, 3).map((l) => `  | ${l}`).join("\n");
    return `The first line of "oldString" does not appear in the source. Use "readSource" to get the latest code.\nSearching for:\n${preview}`;
  }

  if (bestMatchLength === searchLines.length) {
    // All lines match trimmed but not exact — it's a whitespace/indentation issue
    const actualLines = sourceLines.slice(bestMatchStart, bestMatchStart + bestMatchLength);
    const preview = actualLines.slice(0, 5).map((l, idx) => `  ${bestMatchStart + idx + 1} | ${l}`).join("\n");
    return `Found a fuzzy match at line ${bestMatchStart + 1} but indentation differs. This should have been caught by fuzzy matching — if you see this, the source may have changed. Actual source:\n${preview}`;
  }

  // Partial match — show where it diverges
  const divergeIdx = bestMatchStart + bestMatchLength;
  const actualLine = divergeIdx < sourceLines.length ? sourceLines[divergeIdx] : "(end of file)";
  const expectedLine = bestMatchLength < searchLines.length ? searchLines[bestMatchLength] : "(end of oldString)";

  return (
    `Partial match found at line ${bestMatchStart + 1} (${bestMatchLength}/${searchLines.length} lines matched). ` +
    `Diverges at line ${divergeIdx + 1}:\n` +
    `  Expected: ${expectedLine.trim()}\n` +
    `  Actual:   ${typeof actualLine === "string" ? actualLine.trim() : actualLine}\n` +
    `Use "readSource" to get the latest code before retrying.`
  );
}
