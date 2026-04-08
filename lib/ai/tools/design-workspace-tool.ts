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
import type { AssetContext } from "../../design/types";
import {
  exportDesignAsset,
  type DesignExportFormat,
} from "../../design/workspace/export";
import { inferDesignMode, type DesignExportMode } from "../../design/workspace/preview";
import { getFullPathFromMediaRef } from "../../storage/local-storage";
import fs from "fs/promises";
import path from "path";

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
  /** ID of the component being edited — returned in the result for store targeting */
  activeComponentId?: string;

  label?: string;
  snapshotId?: string;

  /** Image/asset URLs to incorporate into the design. For "generate" and "edit". */
  assets?: Array<{ url: string; description?: string }>;

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

// ---------------------------------------------------------------------------
// Server-side component cache (survives hot reloads via globalThis)
// ---------------------------------------------------------------------------

const componentCache = (
  (globalThis as Record<string, unknown>).__designComponentCache ??= new Map<string, string>()
) as Map<string, string>;

function cacheKey(sessionId: string, componentId: string): string {
  return `${sessionId}:${componentId}`;
}

function cacheComponent(sessionId: string, componentId: string, code: string): void {
  componentCache.set(cacheKey(sessionId, componentId), code);
  // FIFO eviction at 200 entries
  if (componentCache.size > 200) {
    const firstKey = componentCache.keys().next().value;
    if (firstKey) componentCache.delete(firstKey);
  }
}

function getCachedComponent(sessionId: string, componentId: string): string | undefined {
  return componentCache.get(cacheKey(sessionId, componentId));
}

// ---------------------------------------------------------------------------

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

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Parse a `data:` URI into its base64 payload and MIME type.
 * Returns null for non-data URIs or malformed values.
 */
function parseDataUri(uri: string): { base64Data: string; mediaType: string } | null {
  const match = uri.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) return null;
  return { mediaType: match[1], base64Data: match[2] };
}

/**
 * Convert a raw filesystem media path to an `/api/media/` URL.
 * Handles paths like `/Users/.../seline/.local-data/media/sessionId/role/file.png`
 * by extracting the relative portion after `/media/`.
 */
function filesystemPathToMediaUrl(filePath: string): string | null {
  const mediaMarker = /[/\\]media[/\\]/;
  const match = filePath.match(mediaMarker);
  if (!match || match.index === undefined) return null;
  const relativePart = filePath.slice(match.index + match[0].length).replace(/\\/g, "/");
  return relativePart ? `/api/media/${relativePart}` : null;
}

/**
 * Resolve input assets into `AssetContext[]` with multimodal data.
 *
 * The outer chat agent may pass `/api/media/...` paths, `data:` URIs,
 * or raw filesystem paths. In all cases we normalize to an `/api/media/`
 * URL and extract base64 for multimodal vision.
 */
async function resolveAssets(
  inputAssets: Array<{ url: string; description?: string }>,
): Promise<AssetContext[]> {
  return Promise.all(
    inputAssets.map(async (asset, index) => {
      const ctx: AssetContext = {
        id: `asset-${index}`,
        url: asset.url,
        alt: asset.description,
        metadata: asset.description ? { description: asset.description } : undefined,
      };

      // Data URIs — extract base64 for multimodal
      const parsed = parseDataUri(asset.url);
      if (parsed) {
        ctx.base64Data = parsed.base64Data;
        ctx.mediaType = parsed.mediaType;
        return ctx;
      }

      // Normalize filesystem paths to /api/media/ URLs
      if (!asset.url.startsWith("/api/media/") && !asset.url.startsWith("http")) {
        const mediaUrl = filesystemPathToMediaUrl(asset.url);
        if (mediaUrl) {
          ctx.url = mediaUrl;
        }
      }

      // /api/media/ paths — read from disk for multimodal
      const mediaRef = ctx.url.startsWith("/api/media/") ? ctx.url : asset.url;
      const fullPath = getFullPathFromMediaRef(mediaRef);
      if (fullPath) {
        // Path traversal protection: resolved path must live under the storage root.
        // getFullPathFromMediaRef already validates via resolveUnderStorage, but we
        // add an explicit check here as defense-in-depth against any future changes.
        const storageRoot = path.resolve(
          process.env.LOCAL_DATA_PATH
            ? path.resolve(process.env.LOCAL_DATA_PATH, "media")
            : path.resolve(process.cwd(), ".local-data", "media")
        );
        const resolvedFull = path.resolve(fullPath);
        if (!resolvedFull.startsWith(storageRoot + path.sep) && resolvedFull !== storageRoot) {
          // Path escapes media storage directory — skip this asset
          return ctx;
        }

        try {
          const buffer = await fs.readFile(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          const mediaType = IMAGE_MEDIA_TYPES[ext];
          if (mediaType) {
            ctx.base64Data = buffer.toString("base64");
            ctx.mediaType = mediaType;
          }
        } catch {
          // File not accessible — proceed without multimodal
        }
      }

      return ctx;
    }),
  );
}

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
      return handleGenerate(options, input);
    case "edit":
      return handleEdit(options, input);
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
- "generate": Generate a new UI component from a text prompt. Requires \`prompt\`. Optional: \`mode\`, \`style\`, \`assets\` (array of {url, description} for user-uploaded images to incorporate).
- "edit": Edit the active component with a text instruction. Requires \`editPrompt\`. Pass \`activeComponentId\` to reference a previously generated component (code is cached server-side). Optional: \`activeComponentCode\` (override), \`assets\`.
- "snapshot": Take a snapshot of the current workspace state.
- "restore": Restore a previous snapshot. Requires \`snapshotId\`.
- "export": Export the active component as HTML, React, PNG, or MP4. Pass \`activeComponentId\` or \`activeComponentCode\`.
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
        assets: {
          type: "array",
          description: 'Image or asset URLs to use in the design (e.g. /api/media/... paths from user uploads). For "generate" and "edit".',
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL of the asset." },
              description: { type: "string", description: "Brief description of the asset content." },
            },
            required: ["url"],
            additionalProperties: false,
          },
        },
        editPrompt: {
          type: "string",
          description: 'Natural-language edit instruction. Required for "edit".',
        },
        inlineMode: {
          type: "boolean",
          description: 'Whether to apply edits inline (default true). For "edit".',
        },
        activeComponentCode: {
          type: "string",
          description: 'Component code override. Optional — if omitted, the server uses the cached code from the last generate/edit for this component.',
        },
        activeComponentId: {
          type: "string",
          description: 'ID of the component to edit or export. Used to look up cached code server-side.',
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

async function handleGenerate(options: DesignWorkspaceToolOptions, input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const { prompt, mode = "html", style = "default", assets: inputAssets } = input;

  if (!prompt?.trim()) {
    return { success: false, action: "generate", error: 'Missing or empty "prompt" for generate action.' };
  }

  const assets = inputAssets?.length ? await resolveAssets(inputAssets) : undefined;

  let finalCode = "";
  let generationError: string | undefined;

  for await (const event of generateCard({ prompt, mode, style, assets })) {
    if (event.type === "complete") {
      finalCode = event.content;
    }
    if (event.type === "error") {
      generationError = event.error.message;
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

  // Cache the generated code so subsequent edits don't need to re-pass it
  const sessionId = options.sessionId ?? "UNSCOPED";
  cacheComponent(sessionId, componentId, finalCode);

  // previewHtml is NOT included in the tool result to keep the response slim.
  // For Tailwind components, the compiled preview can be 100K+ (bundled React
  // runtime, lucide-react, etc.). The client-side preview frame falls back to
  // the compile-preview API automatically via useCompileTailwindPreview().
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

async function handleEdit(options: DesignWorkspaceToolOptions, input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const { editPrompt, inlineMode = true, activeComponentCode, activeComponentId, assets: inputAssets } = input;

  if (!editPrompt?.trim()) {
    return { success: false, action: "edit", error: 'Missing required field "editPrompt" for edit action.' };
  }

  // Resolve component code: explicit param > server-side cache
  const sessionId = options.sessionId ?? "UNSCOPED";
  let code = activeComponentCode?.trim() || undefined;
  if (!code && activeComponentId) {
    code = getCachedComponent(sessionId, activeComponentId);
  }
  if (!code) {
    return {
      success: false,
      action: "edit",
      error: 'No component code available. Either pass "activeComponentCode" or ensure the component was generated in this session.',
    };
  }

  const assets = inputAssets?.length ? await resolveAssets(inputAssets) : undefined;

  let finalCode = "";
  let editError: string | undefined;

  for await (const event of editCard({ code, editPrompt, inlineMode, assets })) {
    if (event.type === "complete") {
      finalCode = event.content;
    }
    if (event.type === "error") {
      editError = event.error.message;
    }
  }

  if (editError || !finalCode.trim()) {
    return {
      success: false,
      action: "edit",
      error: editError ?? "Edit produced empty output. Try rephrasing the instruction.",
    };
  }

  // Update cache with edited code for subsequent edits
  if (activeComponentId) {
    cacheComponent(sessionId, activeComponentId, finalCode);
  }

  // previewHtml excluded — same rationale as handleGenerate.
  return {
    success: true,
    action: "edit",
    data: {
      componentId: activeComponentId,
      code: finalCode,
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
  const sessionId = options.sessionId ?? "UNSCOPED";
  let activeComponentCode = input.activeComponentCode?.trim() || undefined;
  if (!activeComponentCode && input.activeComponentId) {
    activeComponentCode = getCachedComponent(sessionId, input.activeComponentId);
  }
  if (!activeComponentCode) {
    return {
      success: false,
      action: "export",
      error: 'No component code available. Either pass "activeComponentCode" or ensure the component was generated in this session.',
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
