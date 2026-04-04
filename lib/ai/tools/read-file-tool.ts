/**
 * Read File Tool
 *
 * AI tool for reading file content from Synced Folders or Knowledge Base.
 * Enhanced with:
 * - Binary file detection (prevents dumping binary garbage)
 * - Head/Tail support for reading large files
 * - Line range support
 * - Knowledge Base integration
 */

import { tool, jsonSchema } from "ai";
import { readFile } from "fs/promises";
import { basename } from "path";
import {
  isPathAllowed,
  resolveWorkspaceAwarePaths,
  recordFileRead,
  findSimilarFiles,
} from "@/lib/ai/filesystem";
import { findAgentDocumentByName, getAgentDocumentChunksByDocumentId } from "@/lib/db/queries";
import {
  getCodeLanguage,
  isBinaryFile,
  selectLines,
  formatLinesWithNumbers,
} from "@/lib/ai/tools/file-content-utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB
const MAX_LINE_COUNT = 5000;
const MAX_LINE_WIDTH = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReadFileToolOptions {
  sessionId: string;
  characterId?: string | null;
  userId: string;
}

interface ReadFileInput {
  filePath: string;
  startLine?: number;
  endLine?: number;
  head?: number;
  tail?: number;
}

interface ReadFileResult {
  status: "success" | "error";
  filePath?: string;
  language?: string;
  lineRange?: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  content?: string;
  truncated?: boolean;
  message?: string;
  text?: string;
  error?: string;
  source?: "synced_folder" | "knowledge_base";
  documentTitle?: string;
  allowedFolders?: string[];
  isBinary?: boolean;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const readFileSchema = jsonSchema<ReadFileInput>({
  type: "object",
  title: "ReadFileInput",
  description: "Input schema for reading files from synced folders or knowledge base",
  properties: {
    filePath: {
      type: "string",
      description:
        "File path or document name to read. Can be: (1) Knowledge Base document filename or title, (2) relative path from synced folder, or (3) absolute path within synced folders",
    },
    startLine: {
      type: "number",
      minimum: 1,
      description: "Start line number (1-indexed, optional)",
    },
    endLine: {
      type: "number",
      minimum: 1,
      description: "End line number (1-indexed, optional)",
    },
    head: {
      type: "number",
      minimum: 1,
      description: "Read the first N lines of the file (optional)",
    },
    tail: {
      type: "number",
      minimum: 1,
      description: "Read the last N lines of the file (optional)",
    },
  },
  required: ["filePath"],
  additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Knowledge Base Logic
// ---------------------------------------------------------------------------

async function tryReadFromKnowledgeBase(
  characterId: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
  head?: number,
  tail?: number
): Promise<ReadFileResult | null> {
  try {
    const document = await findAgentDocumentByName(characterId, filePath);

    if (!document) {
      return null;
    }

    const chunks = await getAgentDocumentChunksByDocumentId(document.id, document.userId);

    if (!chunks.length) {
      return null;
    }

    const content = chunks.map((chunk) => chunk.text).join("\n\n---\n\n");
    const allLines = content.split("\n");

    const { lines: selectedLines, actualStartLine, actualEndLine } = selectLines(allLines, {
      head, tail, startLine, endLine, maxLineCount: MAX_LINE_COUNT,
    });

    const lang = getCodeLanguage(document.originalFilename);
    const formattedContent = formatLinesWithNumbers(selectedLines, actualStartLine);

    const truncated = selectedLines.length < allLines.length;
    const displayName = document.title || document.originalFilename;

    return {
      status: "success",
      filePath: document.originalFilename,
      language: lang,
      lineRange: `${actualStartLine}-${actualEndLine}`,
      startLine: actualStartLine,
      endLine: actualEndLine,
      totalLines: allLines.length,
      content: formattedContent,
      truncated,
      message: truncated
        ? `Showing lines ${actualStartLine}-${actualEndLine} of ${allLines.length} total lines from Knowledge Base document "${displayName}"`
        : `Read ${allLines.length} lines from Knowledge Base document "${displayName}"`,
      source: "knowledge_base",
      documentTitle: document.title || undefined,
    };
  } catch (error) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool Factory
// ---------------------------------------------------------------------------

export function createReadFileTool(options: ReadFileToolOptions) {
  const { sessionId, characterId } = options;

  return tool({
    description: `Read full file content or a specific line range from Knowledge Base documents or synced folders.

**Supported Sources:**
1. **Knowledge Base documents** - Uploaded PDFs, text, Markdown, HTML files. Reference by filename or title.
2. **Synced folder files** - Files from indexed folders.

**Features:**
- **Smart Limiting**: Reads first 5000 lines by default.
- **Single Selection Mode**: Use exactly one mode per call: ('head') OR ('tail') OR ('startLine'/'endLine').
- **Head/Tail**: Use 'head' to read first N lines, 'tail' to read last N lines.
- **Line Range**: Use 'startLine'/'endLine' for specific sections.
- **Binary Detection**: Automatically prevents reading binary files.

**Returns:** File content with line numbers, language detection, and truncation info.`,

    inputSchema: readFileSchema,

    execute: async (input: ReadFileInput): Promise<ReadFileResult> => {
      if (!characterId) {
        return {
          status: "error",
          error: "Read File requires an agent context.",
        };
      }

      const { filePath, startLine, endLine, head, tail } = input;

      // Guard: reject non-finite or negative numeric params early.
      // Degenerate model output (e.g. token repetition loops) can produce
      // Infinity or NaN values that bypass downstream range checks.
      if (startLine !== undefined && (!Number.isFinite(startLine) || startLine < 1)) {
        return { status: "error", error: `Invalid startLine: ${startLine}. Must be a positive integer.` };
      }
      if (endLine !== undefined && (!Number.isFinite(endLine) || endLine < 1)) {
        return { status: "error", error: `Invalid endLine: ${endLine}. Must be a positive integer.` };
      }
      if (head !== undefined && (!Number.isFinite(head) || head < 1)) {
        return { status: "error", error: `Invalid head: ${head}. Must be a positive integer.` };
      }
      if (tail !== undefined && (!Number.isFinite(tail) || tail < 1)) {
        return { status: "error", error: `Invalid tail: ${tail}. Must be a positive integer.` };
      }
      if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
        return { status: "error", error: `endLine (${endLine}) must be >= startLine (${startLine}).` };
      }

      // Validation
      if ((head || tail) && (startLine || endLine)) {
         return {
           status: "error",
           error: "Cannot specify both head/tail and startLine/endLine parameters.",
         };
      }
      if (head && tail) {
        return {
          status: "error",
          error: "Cannot specify both head and tail parameters.",
        };
      }

      // Guard: reject absurdly large range requests to prevent context bloat
      const MAX_RANGE_LINES = 10_000;
      if (head && head > MAX_RANGE_LINES) {
        return {
          status: "error",
          error: `Requested head=${head} exceeds maximum range of ${MAX_RANGE_LINES} lines. Use a smaller range or startLine/endLine.`,
        };
      }
      if (tail && tail > MAX_RANGE_LINES) {
        return {
          status: "error",
          error: `Requested tail=${tail} exceeds maximum range of ${MAX_RANGE_LINES} lines. Use a smaller range or startLine/endLine.`,
        };
      }
      if (startLine && endLine && (endLine - startLine + 1) > MAX_RANGE_LINES) {
        return {
          status: "error",
          error: `Requested range (${startLine}-${endLine} = ${endLine - startLine + 1} lines) exceeds maximum of ${MAX_RANGE_LINES} lines. Use a smaller range.`,
        };
      }

      // STEP 1: Knowledge Base
      const kbResult = await tryReadFromKnowledgeBase(
        characterId,
        filePath,
        startLine,
        endLine,
        head,
        tail
      );
      if (kbResult) {
        return kbResult;
      }

      // STEP 2: Synced Folders (workspace-aware — worktree path is included if active)
      let syncedFolders: string[];
      try {
        // resolveWorkspaceAwarePaths already includes shared workflow folders
        // (via resolveSyncedFolderPaths → getAccessibleSyncFolders) and applies
        // worktree isolation filtering. No extra merge needed.
        syncedFolders = await resolveWorkspaceAwarePaths(characterId, sessionId);
        if (syncedFolders.length === 0) {
          return {
            status: "error",
            error: "No matching documents found. No synced folders configured and no Knowledge Base document matches this filename.",
          };
        }
      } catch (error) {
        return {
          status: "error",
          error: `Failed to get synced folders: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }

      // Validate Path
      const validPath = await isPathAllowed(filePath, syncedFolders);
      if (!validPath) {
        const suggestions = await findSimilarFiles(characterId, filePath);
        // Keep hard error when suggestions exist (likely a typo the model can fix).
        // Use soft redirect when no suggestions — the file is simply outside synced
        // folders and the model should use its built-in Read tool instead.
        if (suggestions.length > 0) {
          const suggestionText = ` Did you mean: ${suggestions.map(s => `"${s}"`).join(", ")}?`;
          return {
            status: "error",
            error: `File not found in Knowledge Base or synced folders.${suggestionText}`,
            allowedFolders: syncedFolders,
          };
        }
        return {
          status: "success",
          text: `File not found in Knowledge Base or synced folders. Use the Read tool to read files from the filesystem directly.`,
        };
      }

      // Binary Check — soft redirect so the UI doesn't show an error icon.
      // The model will retry with its built-in Read tool which handles images.
      if (await isBinaryFile(validPath)) {
        return {
          status: "success",
          text: `File "${basename(validPath)}" is a binary file (image, compiled, etc). The readFile tool only supports text files. Use the Read tool to read binary/image files from the filesystem.`,
          filePath: validPath,
          isBinary: true,
        };
      }

      // Read File
      try {
        const content = await readFile(validPath, "utf-8");
        const allLines = content.split("\n");

        if (content.length > MAX_FILE_SIZE_BYTES) {
           if (!head && !tail && !startLine && !endLine) {
              return {
                status: "error",
                error: `File too large (${Math.round(content.length / 1024)}KB). Max: ${MAX_FILE_SIZE_BYTES / 1024}KB. Try using 'head' or 'tail' to read a portion.`,
                source: "synced_folder",
              };
           }
        }

        const { lines: selectedLines, actualStartLine, actualEndLine } = selectLines(allLines, {
          head, tail, startLine, endLine, maxLineCount: MAX_LINE_COUNT,
        });

        const lang = getCodeLanguage(validPath);
        const formattedContent = formatLinesWithNumbers(selectedLines, actualStartLine, MAX_LINE_WIDTH);

        const truncated = selectedLines.length < allLines.length;

        // Record Read
        recordFileRead(sessionId, validPath);

        return {
          status: "success",
          filePath: validPath,
          language: lang,
          lineRange: `${actualStartLine}-${actualEndLine}`,
          startLine: actualStartLine,
          endLine: actualEndLine,
          totalLines: allLines.length,
          content: formattedContent,
          truncated,
          message: truncated
            ? `Showing lines ${actualStartLine}-${actualEndLine} of ${allLines.length} total lines`
            : `Read ${allLines.length} lines from ${basename(validPath)}`,
          source: "synced_folder",
        };
      } catch (error) {
        return {
          status: "error",
          error: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
}
