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
import { withToolLogging } from "@/lib/ai/tool-registry/logging";
import { generateCard, editCard } from "../../design";
import {
  exportDesignAsset,
  type DesignExportFormat,
} from "../../design/workspace/export";
import { inferDesignMode, type DesignExportMode } from "../../design/workspace/preview";
import { buildTailwindPreviewAsync } from "../../design/workspace/compiler";

interface DesignWorkspaceToolOptions {
  sessionId?: string;
  userId?: string;
  characterId?: string;
}

interface DesignWorkspaceInput {
  action: "open" | "generate" | "edit" | "snapshot" | "restore" | "export" | "close";

  prompt?: string;
  mode?: "html" | "tailwind";
  style?: "apple-glass" | "default";

  editPrompt?: string;
  inlineMode?: boolean;
  activeComponentCode?: string;

  label?: string;
  snapshotId?: string;

  format?: "html" | "react" | "png" | "video";
  componentName?: string;
  width?: number;
  height?: number;
  scale?: number;
  durationMs?: number;
  fps?: number;
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
    renderedHtml?: string;
    /** Server-compiled preview HTML for Tailwind components. */
    previewHtml?: string;
    url?: string;
    localPath?: string;
    filePath?: string;
    fileName?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    fps?: number;
  };
  error?: string;
}

const DEFAULT_EXPORT_SESSION_ID = "design-workspace";
const DEFAULT_EXPORT_WIDTH = 1440;
const DEFAULT_EXPORT_HEIGHT = 900;
const DEFAULT_EXPORT_SCALE = 2;
const DEFAULT_EXPORT_DURATION_MS = 2400;
const DEFAULT_EXPORT_FPS = 24;
const MAX_EXPORT_DIMENSION = 4096;
const MAX_EXPORT_SCALE = 4;
const MAX_EXPORT_DURATION_MS = 8000;
const MAX_EXPORT_FPS = 60;

function generateId(): string {
  return crypto.randomUUID();
}

function nameFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return "Untitled Component";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeExportMode(mode?: string, code?: string): DesignExportMode {
  if (mode === "tailwind" || mode === "html") {
    return mode;
  }

  if (code) {
    return inferDesignMode(code);
  }

  return "html";
}

function normalizeExportFormat(format?: string): DesignExportFormat {
  return format === "react" || format === "png" || format === "video" ? format : "html";
}

function normalizeExportSessionId(sessionId?: string): string {
  const trimmed = sessionId?.trim();
  if (!trimmed || trimmed === "UNSCOPED") {
    return DEFAULT_EXPORT_SESSION_ID;
  }

  return trimmed;
}

function buildExportSuccessMessage(format: DesignExportFormat): string {
  switch (format) {
    case "react":
      return "Component exported as React JSX.";
    case "png":
      return "Component exported as PNG.";
    case "video":
      return "Component exported as MP4 video.";
    default:
      return "Component exported as HTML.";
  }
}

async function executeDesignWorkspace(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput
): Promise<DesignWorkspaceResult> {
  switch (input.action) {
    case "open":
      return handleOpen();
    case "generate":
      return handleGenerate(input);
    case "edit":
      return handleEdit(input);
    case "snapshot":
      return handleSnapshot(input);
    case "restore":
      return handleRestore(input);
    case "export":
      return handleExport(options, input);
    case "close":
      return handleClose();
    default:
      return { success: false, action: String(input.action), error: `Unknown action: ${input.action}` };
  }
}

export function createDesignWorkspaceTool(options: DesignWorkspaceToolOptions = {}) {
  const executeWithLogging = withToolLogging(
    "designWorkspace",
    options.sessionId,
    async (input: DesignWorkspaceInput) => executeDesignWorkspace(options, input)
  );

  return tool({
    description: `Control the design workspace to generate, edit, snapshot, and export UI components.

**Actions:**
- "open": Open the design workspace panel.
- "generate": Generate a new UI component from a text prompt. Requires \`prompt\`. Optional: \`mode\` ("html" | "tailwind"), \`style\` ("apple-glass" | "default").
- "edit": Edit the active component with a text instruction. Requires \`editPrompt\` and \`activeComponentCode\`.
- "snapshot": Take a snapshot of the current workspace state.
- "restore": Restore a previous snapshot. Requires \`snapshotId\`.
- "export": Export the active component as HTML, React, PNG, or MP4. Requires \`activeComponentCode\`.
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
          description: 'Generation or export mode. Optional for "generate" and "export".',
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
          description: 'The current code of the active component. Required for "edit" and "export".',
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
          enum: ["html", "react", "png", "video"],
          description: 'Export format (default "html"). For "export".',
        },
        componentName: {
          type: "string",
          description: 'Optional export filename base and display name. For "export".',
        },
        width: {
          type: "number",
          minimum: 320,
          maximum: MAX_EXPORT_DIMENSION,
          description: 'Export width in pixels. Optional for "export".',
        },
        height: {
          type: "number",
          minimum: 320,
          maximum: MAX_EXPORT_DIMENSION,
          description: 'Export height in pixels. Optional for "export".',
        },
        scale: {
          type: "number",
          minimum: 1,
          maximum: MAX_EXPORT_SCALE,
          description: 'Raster export scale multiplier. Optional for "export".',
        },
        durationMs: {
          type: "number",
          minimum: 500,
          maximum: MAX_EXPORT_DURATION_MS,
          description: 'Video duration in milliseconds. Optional for MP4 export.',
        },
        fps: {
          type: "number",
          minimum: 12,
          maximum: MAX_EXPORT_FPS,
          description: 'Video frames per second. Optional for MP4 export.',
        },
      },
      required: ["action"],
      additionalProperties: false,
    }),
    execute: executeWithLogging,
  });
}

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

  // For Tailwind components, compile server-side so the client gets
  // a ready-to-render preview HTML instead of a loading placeholder.
  let previewHtml: string | undefined;
  if (mode === "tailwind") {
    try {
      previewHtml = await buildTailwindPreviewAsync(finalCode, name);
    } catch (compileError) {
      // Non-fatal: client will fall back to the compile-preview API
      console.warn("[design-workspace] server-side compilation failed:", compileError);
    }
  }

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
      previewHtml,
      message: `Component "${name}" generated successfully.`,
    },
  };
}

async function handleEdit(input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const { editPrompt, inlineMode = false, activeComponentCode } = input;

  if (!editPrompt?.trim()) {
    return { success: false, action: "edit", error: 'Missing required field "editPrompt" for edit action.' };
  }
  if (!activeComponentCode?.trim()) {
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

  // Compile if the result looks like Tailwind/React code
  let previewHtml: string | undefined;
  if (inferDesignMode(finalCode) === "tailwind") {
    try {
      previewHtml = await buildTailwindPreviewAsync(finalCode, "Edited Component");
    } catch {
      // Non-fatal: client will fall back to the compile-preview API
    }
  }

  return {
    success: true,
    action: "edit",
    data: {
      code: finalCode,
      previewHtml,
      message: "Component edited successfully.",
    },
  };
}

function handleSnapshot(input: DesignWorkspaceInput): DesignWorkspaceResult {
  return {
    success: true,
    action: "snapshot",
    data: {
      message: input.label ? `Snapshot "${input.label}" requested.` : "Snapshot requested.",
      ...(input.label ? { name: input.label } : {}),
    },
  };
}

function handleRestore(input: DesignWorkspaceInput): DesignWorkspaceResult {
  if (!input.snapshotId) {
    return { success: false, action: "restore", error: 'Missing required field "snapshotId" for restore action.' };
  }

  return {
    success: true,
    action: "restore",
    data: {
      snapshotId: input.snapshotId,
      message: `Snapshot "${input.snapshotId}" restore requested.`,
    },
  };
}

async function handleExport(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput
): Promise<DesignWorkspaceResult> {
  const activeComponentCode = input.activeComponentCode?.trim();
  if (!activeComponentCode) {
    return {
      success: false,
      action: "export",
      error: 'Missing "activeComponentCode" for export. Provide the component code to export.',
    };
  }

  const format = normalizeExportFormat(input.format);
  const mode = normalizeExportMode(input.mode, activeComponentCode);
  const componentName = input.componentName?.trim() || "Design Component";

  try {
    const exportResult = await exportDesignAsset({
      code: activeComponentCode,
      format,
      mode,
      componentName,
      sessionId: normalizeExportSessionId(options.sessionId),
      width: clampNumber(input.width, DEFAULT_EXPORT_WIDTH, 320, MAX_EXPORT_DIMENSION),
      height: clampNumber(input.height, DEFAULT_EXPORT_HEIGHT, 320, MAX_EXPORT_DIMENSION),
      scale: clampNumber(input.scale, DEFAULT_EXPORT_SCALE, 1, MAX_EXPORT_SCALE),
      durationMs: clampNumber(input.durationMs, DEFAULT_EXPORT_DURATION_MS, 500, MAX_EXPORT_DURATION_MS),
      fps: clampNumber(input.fps, DEFAULT_EXPORT_FPS, 12, MAX_EXPORT_FPS),
    });

    return {
      success: true,
      action: "export",
      data: {
        code: exportResult.code,
        format: exportResult.format,
        message: buildExportSuccessMessage(exportResult.format),
        mode,
        name: componentName,
        renderedHtml: exportResult.renderedHtml,
        url: exportResult.url,
        localPath: exportResult.localPath,
        filePath: exportResult.filePath,
        fileName: exportResult.fileName,
        width: exportResult.width,
        height: exportResult.height,
        durationMs: exportResult.durationMs,
        fps: exportResult.fps,
      },
    };
  } catch (error) {
    return {
      success: false,
      action: "export",
      error: error instanceof Error ? error.message : "Export failed.",
    };
  }
}

function handleClose(): DesignWorkspaceResult {
  return {
    success: true,
    action: "close",
    data: { message: "Design workspace closed." },
  };
}
