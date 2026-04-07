import { tool, jsonSchema } from "ai";
import { withToolLogging } from "@/lib/ai/tool-registry/logging";
import { retrieveFullContent as getFullContent, listStoredContent } from "@/lib/ai/truncated-content-store";

// ==========================================================================
// Retrieve Full Content Tool
// ==========================================================================
// This tool allows the AI to retrieve full untruncated content when text
// was truncated for token efficiency. The full content is stored in the
// session and can be retrieved using the reference ID.

const retrieveFullContentSchema = jsonSchema<{
  contentId: string;
}>({
  type: "object",
  title: "RetrieveFullContentInput",
  description: "Input schema for retrieving full untruncated content",
  properties: {
    contentId: {
      type: "string",
      description:
        "The reference ID of the truncated content to retrieve (format: trunc_XXXXXXXX). This ID is provided in truncation notices.",
    },
  },
  required: ["contentId"],
  additionalProperties: false,
});

interface RetrieveFullContentToolOptions {
  /** Current session ID for retrieving content */
  sessionId: string;
}

interface RetrieveFullContentArgs {
  contentId: string;
}

/**
 * Core retrieveFullContent execution logic
 */
async function executeRetrieveFullContent(
  options: RetrieveFullContentToolOptions,
  args: RetrieveFullContentArgs
) {
  const { sessionId } = options;
  const { contentId } = args;

  // Retrieve the full content
  const entry = getFullContent(sessionId, contentId);

  if (!entry) {
    // Check if there's any stored content for debugging
    const storedContent = listStoredContent(sessionId);

    return {
      status: "not_found",
      contentId,
      message: `Content with ID "${contentId}" was not found. It may have expired (TTL: 1 hour) or the ID is incorrect.`,
      availableContentIds: storedContent.map(c => ({
        id: c.id,
        context: c.context,
        fullLength: c.fullLength,
      })),
    };
  }

  return {
    status: "success",
    contentId: entry.id,
    context: entry.context,
    fullLength: entry.fullLength,
    truncatedLength: entry.truncatedLength,
    fullContent: entry.fullContent,
    message: `Successfully retrieved full content (${entry.fullLength.toLocaleString()} characters). The content was originally truncated to ${entry.truncatedLength.toLocaleString()} characters.`,
  };
}

export function createRetrieveFullContentTool(options: RetrieveFullContentToolOptions) {
  const { sessionId } = options;

  // Wrap the execute function with logging
  const executeWithLogging = withToolLogging(
    "retrieveFullContent",
    sessionId,
    (args: RetrieveFullContentArgs) => executeRetrieveFullContent(options, args)
  );

  return tool({
    description: `**⚠️ ONLY for truncated content, NOT for file reading!**

This retrieves content that was previously TRUNCATED in a tool response.

**When to use:**
- You see "Content truncated. Reference ID: trunc_XXXXXXXX" in a previous tool result
- You need the full content that was cut off

**When NOT to use (WRONG):**
- ❌ Reading file contents (use readFile instead)
- ❌ Getting full file paths (use localGrep or vectorSearch)
- ❌ Any contentId that doesn't start with "trunc_"

**Parameter:** contentId must be exactly like "trunc_ABC123" from a truncation notice.`,
    inputSchema: retrieveFullContentSchema,
    execute: executeWithLogging,
  });
}
