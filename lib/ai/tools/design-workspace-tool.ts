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
  detectAvailableLibraries,
  getAvailableLibrariesPrompt,
  registerRuntimeLibrary,
  validatePackageSpec,
  ensureSandboxDir,
  SANDBOX_DIR,
  type DesignLibrary,
} from "../../design/libraries";
import {
  exportDesignAsset,
  type DesignExportFormat,
} from "../../design/workspace/export";
import { type DesignExportMode } from "../../design/workspace/preview";
import { getFullPathFromMediaRef } from "../../storage/local-storage";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
const execFileAsync = promisify(execFile);

interface DesignWorkspaceToolOptions {
  sessionId?: string;
  userId?: string;
  characterId?: string;
}

interface DesignWorkspaceInput {
  action: "open" | "generate" | "edit" | "snapshot" | "restore" | "export" | "close" | "install";

  /** npm package names to install. Required for "install" action. */
  packages?: string[];

  prompt?: string;
  mode?: "tailwind";
  style?: "apple-glass" | "default";

  editPrompt?: string;
  activeComponentCode?: string;
  activeComponentId?: string;

  label?: string;
  snapshotId?: string;

  code?: string;
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
    availableLibraries?: string[];
  };
  error?: string;
}

let _librariesPromise: Promise<DesignLibrary[]> | null = null;

function getAvailableLibraries(): Promise<DesignLibrary[]> {
  if (!_librariesPromise) {
    _librariesPromise = detectAvailableLibraries().catch((err) => {
      _librariesPromise = null;
      throw err;
    });
  }
  return _librariesPromise;
}

const componentCache = (
  (globalThis as Record<string, unknown>).__designComponentCache ??= new Map<string, string>()
) as Map<string, string>;

function cacheKey(sessionId: string, componentId: string): string {
  return `${sessionId}:${componentId}`;
}

function cacheComponent(sessionId: string, componentId: string, code: string): void {
  const key = cacheKey(sessionId, componentId);
  componentCache.delete(key);
  componentCache.set(key, code);
  if (componentCache.size > 200) {
    const firstKey = componentCache.keys().next().value;
    if (firstKey) componentCache.delete(firstKey);
  }
}

export function getCachedComponent(sessionId: string, componentId: string): string | undefined {
  const key = cacheKey(sessionId, componentId);
  const value = componentCache.get(key);
  if (value !== undefined) {
    componentCache.delete(key);
    componentCache.set(key, value);
  }
  return value;
}

export function resolveComponentCode(sessionId: string, code: string): string | null {
  if (!code.startsWith("cached:")) return code;
  const id = code.slice("cached:".length);
  return getCachedComponent(sessionId, id) ?? null;
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

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function parseDataUri(uri: string): { base64Data: string; mediaType: string } | null {
  const match = uri.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) return null;
  return { mediaType: match[1], base64Data: match[2] };
}

function filesystemPathToMediaUrl(filePath: string): string | null {
  const mediaMarker = /[/\\]media[/\\]/;
  const match = filePath.match(mediaMarker);
  if (!match || match.index === undefined) return null;
  const relativePart = filePath.slice(match.index + match[0].length).replace(/\\/g, "/");
  return relativePart ? `/api/media/${relativePart}` : null;
}

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

      const parsed = parseDataUri(asset.url);
      if (parsed) {
        ctx.base64Data = parsed.base64Data;
        ctx.mediaType = parsed.mediaType;
        return ctx;
      }

      if (!asset.url.startsWith("/api/media/") && !asset.url.startsWith("http")) {
        const mediaUrl = filesystemPathToMediaUrl(asset.url);
        if (mediaUrl) {
          ctx.url = mediaUrl;
        }
      }

      const mediaRef = ctx.url.startsWith("/api/media/") ? ctx.url : asset.url;
      const fullPath = getFullPathFromMediaRef(mediaRef);
      if (fullPath) {
        const storageRoot = path.resolve(
          process.env.LOCAL_DATA_PATH
            ? path.resolve(process.env.LOCAL_DATA_PATH, "media")
            : path.resolve(process.cwd(), ".local-data", "media")
        );
        const resolvedFull = path.resolve(fullPath);
        if (!resolvedFull.startsWith(storageRoot + path.sep) && resolvedFull !== storageRoot) {
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

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
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
    case "install":
      return handleInstall(input);
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
    description: `Control the design workspace to generate, edit, snapshot, export UI components, and install external libraries.

**Actions:**
- "open": Open the design workspace panel.
- "install": Install npm packages for use in designs. Provide \`packages\` array (e.g. ["three", "@react-three/fiber"]). Packages are installed via npm and become available for import in generated components.
- "generate": Generate a new UI component. Provide \`code\` (direct TSX) to render your own code, OR \`prompt\` for AI generation. Optional: \`mode\`, \`style\`, \`assets\`.
- "edit": Edit the active component. Provide \`activeComponentCode\` WITHOUT \`editPrompt\` to directly replace the code, OR provide \`editPrompt\` for AI-driven full-file rewriting. Pass \`activeComponentId\` to reference a previously generated component. Optional: \`style\`, \`assets\`.
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
          enum: ["open", "generate", "edit", "snapshot", "restore", "export", "close", "install"],
          description: "The workspace action to perform.",
        },
        packages: {
          type: "array",
          items: { type: "string" },
          description: 'npm package names to install (e.g. ["three", "@react-three/fiber"]). Required for "install" action.',
        },
        prompt: {
          type: "string",
          description: 'Text description of the component to generate. Required for "generate" unless "code" is provided.',
        },
        code: {
          type: "string",
          description: 'Direct TSX/React component code. If provided for "generate", skips AI generation and renders this code directly. The code should be a complete React component with `export default`.',
        },
        mode: {
          type: "string",
          enum: ["tailwind"],
          description: 'Generation mode (always "tailwind"). Optional for "generate" and "export".',
        },
        style: {
          type: "string",
          enum: ["apple-glass", "default"],
          description: 'Visual style for generation or editing. Defaults to "default".',
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
          description: 'Natural-language edit instruction for AI-driven editing. Required for "edit" unless providing "activeComponentCode" for direct replacement.',
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

async function handleOpen(): Promise<DesignWorkspaceResult> {
  const libraries = await getAvailableLibraries();
  const available = libraries.filter((library) => library.available).map((library) => library.package);
  return {
    success: true,
    action: "open",
    data: {
      message: "Design workspace opened.",
      availableLibraries: available.length > 0 ? available : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Install handler
// ---------------------------------------------------------------------------

/** Install mutex to prevent concurrent npm installs in the sandbox. */
let _installLock: Promise<void> | null = null;

/**
 * Get the platform-appropriate npm command.
 * On Windows, npm is invoked as `npm.cmd` because `execFile` doesn't
 * use a shell and won't resolve `.cmd` extensions automatically.
 */
function getNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function handleInstall(input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const packages = input.packages?.filter((p) => typeof p === "string" && p.trim());
  if (!packages || packages.length === 0) {
    return {
      success: false,
      action: "install",
      error: 'Provide a "packages" array with at least one npm package name.',
    };
  }

  // Minimal validation — only reject empty strings. npm is the real validator
  // and the AI can read its error messages.
  const validated = packages.map((p) => validatePackageSpec(p));
  const invalid = validated.filter((r) => !r.valid);
  if (invalid.length > 0) {
    return {
      success: false,
      action: "install",
      error: `Empty package specifier(s) found. Provide valid npm package names.`,
    };
  }

  // Pass specs directly to npm — no rewriting, no second-guessing
  const installArgs = validated.map((r) => r.spec);
  // Extract package name from spec (handles @scope/name@version correctly)
  const packageNames = validated.map((r) => {
    const s = r.spec;
    if (s.startsWith("@")) {
      // Scoped: @scope/name or @scope/name@version
      const slashIdx = s.indexOf("/");
      if (slashIdx === -1) return s;
      const afterSlash = s.slice(slashIdx + 1);
      const atIdx = afterSlash.indexOf("@");
      return atIdx === -1 ? s : s.slice(0, slashIdx + 1 + atIdx);
    }
    const atIdx = s.indexOf("@");
    return atIdx === -1 ? s : s.slice(0, atIdx);
  });

  // Serialize installs — chain promises so concurrent calls queue properly
  const doInstall = async () => {
    await ensureSandboxDir();
    const npmCmd = getNpmCommand();
    await execFileAsync(npmCmd, ["install", "--save", "--ignore-scripts", ...installArgs], {
      cwd: SANDBOX_DIR,
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: "development" },
    });
  };

  _installLock = (_installLock ?? Promise.resolve())
    .catch(() => {}) // don't let a previous failure block the queue
    .then(doInstall);

  try {
    await _installLock;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: "install",
      error: `npm install failed: ${message}`,
    };
  }

  // Register each installed package in the runtime library registry
  for (const name of packageNames) {
    registerRuntimeLibrary({
      name,
      package: name,
      description: `Installed package: ${name}`,
      importExamples: [`import ... from "${name}"`],
    });
  }

  // Reset the cached library detection so next call picks up new packages
  _librariesPromise = null;

  const libraries = await getAvailableLibraries();
  const available = libraries
    .filter((library) => library.available)
    .map((library) => library.package);

  return {
    success: true,
    action: "install",
    data: {
      message: `Successfully installed: ${packageNames.join(", ")}`,
      availableLibraries: available.length > 0 ? available : undefined,
    },
  };
}

async function handleGenerate(options: DesignWorkspaceToolOptions, input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const { prompt, mode = "tailwind", style = "default", assets: inputAssets } = input;

  if (!prompt?.trim() && !input.code?.trim()) {
    return { success: false, action: "generate", error: 'Provide either "prompt" (for AI generation) or "code" (for direct rendering).' };
  }

  const assets = inputAssets?.length ? await resolveAssets(inputAssets) : undefined;

  let finalCode = "";
  let generationError: string | undefined;

  if (input.code?.trim()) {
    finalCode = input.code.trim();
  } else {
    const libraries = await getAvailableLibraries();
    const availableLibrariesBlock = getAvailableLibrariesPrompt(libraries);

    for await (const event of generateCard({ prompt: prompt!, mode, style, assets, availableLibrariesBlock })) {
      if (event.type === "complete") {
        finalCode = event.content;
      }
      if (event.type === "error") {
        generationError = event.error.message;
      }
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
  const name = input.code?.trim() ? "Direct Component" : "Generated Component";
  const sessionId = options.sessionId ?? "UNSCOPED";
  cacheComponent(sessionId, componentId, finalCode);

  const libs = await getAvailableLibraries();
  const availableLibs = libs.filter((library) => library.available).map((library) => library.package);

  return {
    success: true,
    action: "generate",
    data: {
      componentId,
      code: finalCode,
      name,
      prompt: prompt?.trim() ?? undefined,
      mode,
      style,
      message: `Component "${name}" generated successfully.`,
      availableLibraries: availableLibs.length > 0 ? availableLibs : undefined,
    },
  };
}

async function handleEdit(options: DesignWorkspaceToolOptions, input: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const {
    editPrompt,
    style = "default",
    activeComponentCode,
    activeComponentId,
    assets: inputAssets,
  } = input;

  const sessionId = options.sessionId ?? "UNSCOPED";

  if (!editPrompt?.trim() && activeComponentCode?.trim()) {
    const finalCode = activeComponentCode.trim();
    if (activeComponentId) {
      cacheComponent(sessionId, activeComponentId, finalCode);
    }

    return {
      success: true,
      action: "edit",
      data: {
        componentId: activeComponentId,
        code: finalCode,
        message: "Component code replaced directly.",
      },
    };
  }

  if (!editPrompt?.trim()) {
    return { success: false, action: "edit", error: 'Provide "editPrompt" for AI-driven editing, or "activeComponentCode" without "editPrompt" to directly replace the code.' };
  }

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

  for await (const event of editCard({ code, editPrompt, style, assets })) {
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

  if (activeComponentId) {
    cacheComponent(sessionId, activeComponentId, finalCode);
  }

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
  const mode: DesignExportMode = "tailwind";
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
