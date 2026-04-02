/**
 * Design Workspace Tool
 *
 * AI tool for controlling the design workspace programmatically.
 * Allows agents to open/close the workspace, generate and edit components,
 * take and restore snapshots, and export results.
 *
 * The tool does NOT directly interact with the Zustand store (client-side).
 * Instead it returns structured results that the tool UI component uses
 * to update the store.
 */

import { tool, jsonSchema } from "ai";
import { generateCard, editCard } from "../../design";
import { htmlToJsx, validateJsx } from "../../design/utils/jsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DesignWorkspaceInput {
  action: "open" | "generate" | "edit" | "snapshot" | "restore" | "export" | "close";

  // For "generate":
  prompt?: string;
  mode?: "html" | "tailwind";
  style?: "apple-glass" | "default";

  // For "edit":
  editPrompt?: string;
  inlineMode?: boolean;
  /** The current code of the active component (passed by the caller). */
  activeComponentCode?: string;

  // For "snapshot":
  label?: string;

  // For "restore":
  snapshotId?: string;

  // For "export":
  format?: "html" | "react" | "png";
}

interface DesignWorkspaceResult {
  success: boolean;
  action: string;
  data?: {
    componentId?: string;
    code?: string;
    name?: string;
    snapshotId?: string;
    format?: string;
    message?: string;
    prompt?: string;
    mode?: string;
    style?: string;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Derive a short component name from the generation prompt.
 * Falls back to "Untitled Component" for empty/whitespace prompts.
 */
function nameFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return "Untitled Component";
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Convert HTML to a React component export using the shared JSX utilities.
 * Wraps multi-root HTML in a fragment. Validates the result.
 */
function htmlToReactExport(html: string): string {
  const jsx = htmlToJsx(html);
  const validation = validateJsx(jsx);

  // Detect obvious multi-root output; validateJsx() does not catch this.
  const trimmed = jsx.trim();
  const multipleRoots = /^<[^>]+>[\s\S]*<[^/!][^>]*>/.test(trimmed) && !trimmed.startsWith("<>");

  const body = validation.valid && !multipleRoots ? jsx : `<>\n${indent(jsx, 2)}\n</>`;

  return `/* Auto-converted from HTML — review for correctness */\nexport default function GeneratedComponent() {\n  return (\n${indent(body, 4)}\n  );\n}\n`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? pad + line : line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Tool Factory
// ---------------------------------------------------------------------------

export function createDesignWorkspaceTool() {
  return tool({
    description: `Control the design workspace to generate, edit, snapshot, and export UI components.

**Actions:**
- "open": Open the design workspace panel.
- "generate": Generate a new UI component from a text prompt. Requires \`prompt\`. Optional: \`mode\` ("html" | "tailwind", default "html"), \`style\` ("apple-glass" | "default", default "default").
- "edit": Edit the active component with a text instruction. Requires \`editPrompt\` and \`activeComponentCode\`. Optional: \`inlineMode\` (default false).
- "snapshot": Take a snapshot of the current workspace state. Optional: \`label\`.
- "restore": Restore a previous snapshot. Requires \`snapshotId\`.
- "export": Export the active component. Optional: \`format\` ("html" | "react" | "png", default "html"). Requires \`activeComponentCode\` for html/react formats.
- "close": Close the design workspace panel.`,

    inputSchema: jsonSchema<DesignWorkspaceInput>({
      type: "object",
      title: "DesignWorkspaceInput",
      description: "Input for design workspace operations",
      properties: {
        action: {
          type: "string",
          enum: ["open", "generate", "edit", "snapshot", "restore", "export", "close"],
          description: "The workspace action to perform.",
        },
        prompt: {
          type: "string",
          description: 'Text description of the component to generate. Required for "generate".',
        },
        mode: {
          type: "string",
          enum: ["html", "tailwind"],
          description: 'Generation mode (default "html"). For "generate".',
        },
        style: {
          type: "string",
          enum: ["apple-glass", "default"],
          description: 'Visual style (default "default"). For "generate".',
        },
        editPrompt: {
          type: "string",
          description: 'Natural-language edit instruction. Required for "edit".',
        },
        inlineMode: {
          type: "boolean",
          description: 'Whether to apply edits inline (default false). For "edit".',
        },
        activeComponentCode: {
          type: "string",
          description: 'The current code of the active component. Required for "edit" and "export" (html/react).',
        },
        label: {
          type: "string",
          description: 'Human-readable label for the snapshot. For "snapshot".',
        },
        snapshotId: {
          type: "string",
          description: 'ID of the snapshot to restore. Required for "restore".',
        },
        format: {
          type: "string",
          enum: ["html", "react", "png"],
          description: 'Export format (default "html"). For "export".',
        },
      },
      required: ["action"],
      additionalProperties: false,
    }),

    execute: async (input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> => {
      try {
        const { action } = input;

        switch (action) {
          case "open":
            return handleOpen();
          case "generate":
            return await handleGenerate(input);
          case "edit":
            return await handleEdit(input);
          case "snapshot":
            return handleSnapshot(input);
          case "restore":
            return handleRestore(input);
          case "export":
            return handleExport(input);
          case "close":
            return handleClose();
          default:
            return { success: false, action: String(action), error: `Unknown action: ${action}` };
        }
      } catch (error) {
        console.error("[design-workspace] Unexpected error:", error);
        return {
          success: false,
          action: input.action,
          error: `Design workspace operation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleOpen(): DesignWorkspaceResult {
  return {
    success: true,
    action: "open",
    data: { message: "Design workspace opened." },
  };
}

async function handleGenerate(input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const { prompt, mode = "html", style = "default" } = input;

  if (!prompt?.trim()) {
    return { success: false, action: "generate", error: 'Missing or empty "prompt" for generate action.' };
  }

  // Stream the generation and collect the final result
  let finalCode = "";
  let generationError: string | undefined;

  for await (const event of generateCard({ prompt, mode, style })) {
    if (event.type === "complete") {
      finalCode = event.content ?? "";
    }
    if (event.type === "error") {
      generationError = event.error?.message ?? "Generation failed";
    }
  }

  if (generationError || !finalCode.trim()) {
    return {
      success: false,
      action: "generate",
      error: generationError ?? "Generation produced empty output. Try a different prompt.",
    };
  }

  const componentId = generateId();
  const name = nameFromPrompt(prompt);

  return {
    success: true,
    action: "generate",
    data: {
      componentId,
      code: finalCode,
      name,
      prompt: prompt.trim(),
      mode,
      style,
      message: `Component "${name}" generated successfully.`,
    },
  };
}

async function handleEdit(input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const { editPrompt, inlineMode = false, activeComponentCode } = input;

  if (!editPrompt) {
    return { success: false, action: "edit", error: 'Missing required field "editPrompt" for edit action.' };
  }
  if (!activeComponentCode) {
    return {
      success: false,
      action: "edit",
      error: 'Missing required field "activeComponentCode". Provide the current component code to edit.',
    };
  }

  let finalCode = "";
  let editError: string | undefined;

  for await (const event of editCard({ code: activeComponentCode, editPrompt, inlineMode })) {
    if (event.type === "complete") {
      finalCode = event.content ?? "";
    }
    if (event.type === "error") {
      editError = event.error?.message ?? "Edit failed";
    }
  }

  if (editError || !finalCode.trim()) {
    return {
      success: false,
      action: "edit",
      error: editError ?? "Edit produced empty output. Try rephrasing the instruction.",
    };
  }

  return {
    success: true,
    action: "edit",
    data: {
      code: finalCode,
      message: "Component edited successfully.",
    },
  };
}

/**
 * Snapshot handler — returns a signal for the client bridge to call
 * `store.takeSnapshot()`. The store generates and owns the snapshot ID.
 * The tool does NOT generate its own ID to avoid mismatches.
 */
function handleSnapshot(input: DesignWorkspaceInput): DesignWorkspaceResult {
  return {
    success: true,
    action: "snapshot",
    data: {
      message: input.label
        ? `Snapshot "${input.label}" requested.`
        : "Snapshot requested.",
      // label is passed through for the bridge to forward to store.takeSnapshot(label)
      ...(input.label ? { name: input.label } : {}),
    },
  };
}

function handleRestore(input: DesignWorkspaceInput): DesignWorkspaceResult {
  const { snapshotId } = input;

  if (!snapshotId) {
    return { success: false, action: "restore", error: 'Missing required field "snapshotId" for restore action.' };
  }

  return {
    success: true,
    action: "restore",
    data: {
      snapshotId,
      message: `Snapshot "${snapshotId}" restore requested.`,
    },
  };
}

function handleExport(input: DesignWorkspaceInput): DesignWorkspaceResult {
  const { format = "html", activeComponentCode } = input;

  if (format === "png") {
    return {
      success: false,
      action: "export",
      error: "PNG export is not yet implemented. Use 'html' or 'react' format instead.",
    };
  }

  if (!activeComponentCode) {
    return {
      success: false,
      action: "export",
      error: 'Missing "activeComponentCode" for export. Provide the component code to export.',
    };
  }

  if (format === "react") {
    const reactCode = htmlToReactExport(activeComponentCode);
    return {
      success: true,
      action: "export",
      data: {
        code: reactCode,
        format: "react",
        message: "Component exported as React JSX.",
      },
    };
  }

  // Default: html
  return {
    success: true,
    action: "export",
    data: {
      code: activeComponentCode,
      format: "html",
      message: "Component exported as HTML.",
    },
  };
}

function handleClose(): DesignWorkspaceResult {
  return {
    success: true,
    action: "close",
    data: { message: "Design workspace closed." },
  };
}
