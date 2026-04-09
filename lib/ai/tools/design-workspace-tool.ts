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
import { loadSettings } from "@/lib/settings/settings-manager";
import { generateCard, editCard } from "../../design";
import type { AssetContext } from "../../design/types";
import {
  detectAvailableLibraries,
  getAvailableLibrariesPrompt,
  type DesignLibrary,
} from "../../design/libraries";
import {
  exportDesignAsset,
  type DesignExportFormat,
} from "../../design/workspace/export";
import {
  buildDesignPreviewErrorHtml,
  type DesignExportMode,
} from "../../design/workspace/preview";
import {
  buildTailwindPreviewWithMetadata,
  isDesignWorkspaceCompileError,
} from "../../design/workspace/compiler";
import {
  DEFAULT_DESIGN_WORKSPACE_CONFIG,
  getDesignWorkspaceConfigFromSettingsRecord,
  type DesignWorkspaceCompileReport,
  type DesignWorkspaceConfig,
  type DesignWorkspaceValidationResult,
} from "../../design/workspace/config";
import {
  finalizeDesignHistory,
  initDesignHistory,
  peekDesignHistory,
  recordDesignHistory,
  type DesignWorkspaceHistory,
} from "../../design/workspace/edit-history";
import { installSandboxPackages } from "../../design/workspace/dependencies";
import { runPostEditValidation } from "../../design/workspace/validation";
import { getFullPathFromMediaRef } from "../../storage/local-storage";
import fs from "fs/promises";
import path from "path";

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

interface DesignWorkspaceResultData {
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
  /**
   * Compiled preview HTML for the UI bridge (iframe rendering).
   * Stripped from LLM-facing output to avoid sending ~700K+ tokens of bundled JS.
   * The preview frame falls back to the compile API when this is absent.
   * @internal UI-only — never serialized to model context.
   */
  previewHtml?: string;
  url?: string;
  localPath?: string;
  filePath?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
  availableLibraries?: string[];
  compileReport?: DesignWorkspaceCompileReport;
  postEditValidation?: DesignWorkspaceValidationResult;
  history?: DesignWorkspaceHistory;
  config?: DesignWorkspaceConfig;
  missingPackages?: string[];
  autoRecoveryAttempted?: boolean;
  autoRecoveryResult?: "success" | "failed" | "not-needed";
}

interface DesignWorkspaceResult {
  success: boolean;
  action: string;
  data?: DesignWorkspaceResultData;
  error?: string;
}

interface CompiledPreviewSuccess {
  ok: true;
  previewHtml: string;
  compileReport: DesignWorkspaceCompileReport;
}

interface CompiledPreviewFailure {
  ok: false;
  previewHtml: string;
  compileReport: DesignWorkspaceCompileReport;
  error: string;
}

let librariesPromise: Promise<DesignLibrary[]> | null = null;

function getAvailableLibraries(): Promise<DesignLibrary[]> {
  if (!librariesPromise) {
    librariesPromise = detectAvailableLibraries().catch((err) => {
      librariesPromise = null;
      throw err;
    });
  }
  return librariesPromise;
}

function resetAvailableLibrariesCache(): void {
  librariesPromise = null;
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
            : path.resolve(process.cwd(), ".local-data", "media"),
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
          // File not accessible — proceed without multimodal support.
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

function getSessionId(options: DesignWorkspaceToolOptions): string {
  return options.sessionId?.trim() || "UNSCOPED";
}

function getWorkspaceConfig(): DesignWorkspaceConfig {
  try {
    const settings = loadSettings() as unknown as Record<string, unknown>;
    return getDesignWorkspaceConfigFromSettingsRecord(settings);
  } catch {
    return { ...DEFAULT_DESIGN_WORKSPACE_CONFIG };
  }
}

function createEmptyCompileReport(message: string): DesignWorkspaceCompileReport {
  return {
    warnings: [],
    errors: [
      {
        type: "unknown",
        message,
      },
    ],
    dependencyCheck: {
      manifestPackages: [],
      importedPackages: [],
      checkedPackages: [],
      missingManifestPackages: [],
      missingImportedPackages: [],
      missingPackages: [],
    },
    recovered: false,
    durationMs: 0,
  };
}

function ensureHistory(sessionId: string): void {
  initDesignHistory(sessionId);
}

function recordHistory(
  sessionId: string,
  action: DesignWorkspaceInput["action"],
  startedAt: number,
  success: boolean,
  options: {
    componentId?: string;
    validation?: DesignWorkspaceValidationResult;
    metadata?: Record<string, unknown>;
    error?: string;
  } = {},
): void {
  recordDesignHistory(sessionId, {
    action,
    componentId: options.componentId,
    durationMs: Date.now() - startedAt,
    success,
    validation: options.validation,
    metadata: options.metadata,
    error: options.error,
  });
}

async function compilePreviewForTool(
  code: string,
  componentName: string,
  source: string,
): Promise<CompiledPreviewSuccess | CompiledPreviewFailure> {
  try {
    const { html, report } = await buildTailwindPreviewWithMetadata(code, componentName, {
      autoInstallMissingDependencies: true,
      source,
    });

    return {
      ok: true,
      previewHtml: html,
      compileReport: report,
    };
  } catch (error) {
    if (isDesignWorkspaceCompileError(error)) {
      return {
        ok: false,
        previewHtml: buildDesignPreviewErrorHtml(error.message, {
          title: componentName,
          label: "Compilation Failed",
        }),
        compileReport: error.report,
        error: error.message,
      };
    }

    const message = error instanceof Error ? error.message : "Compilation failed.";
    return {
      ok: false,
      previewHtml: buildDesignPreviewErrorHtml(message, {
        title: componentName,
        label: "Compilation Failed",
      }),
      compileReport: createEmptyCompileReport(message),
      error: message,
    };
  }
}

function buildValidationMessage(validation: DesignWorkspaceValidationResult | undefined): string | undefined {
  if (!validation) {
    return undefined;
  }

  if (validation.passed) {
    return `Post-edit checks passed (${validation.checks.length} checks).`;
  }

  const failedChecks = validation.checks.filter((check) => check.status === "fail").length;
  return `Post-edit checks found ${failedChecks} issue${failedChecks === 1 ? "" : "s"}.`;
}

function buildCompileFailureResult(
  action: DesignWorkspaceInput["action"],
  baseData: DesignWorkspaceResultData,
  compileFailure: CompiledPreviewFailure,
): DesignWorkspaceResult {
  return {
    success: false,
    action,
    error: compileFailure.error,
    data: {
      ...baseData,
      previewHtml: compileFailure.previewHtml,
      compileReport: compileFailure.compileReport,
      missingPackages: compileFailure.compileReport.dependencyCheck.missingPackages,
      autoRecoveryAttempted: Boolean(compileFailure.compileReport.autoInstall?.attempted),
      autoRecoveryResult: compileFailure.compileReport.autoInstall
        ? compileFailure.compileReport.autoInstall.success
          ? "success"
          : "failed"
        : "not-needed",
    },
  };
}

/**
 * Strip heavyweight fields from the tool result before it reaches the LLM.
 *
 * `previewHtml` contains the entire compiled bundle (~100K–700K tokens for
 * complex components) and is never useful for the model — it's only needed
 * by the preview iframe.  The `useCompileTailwindPreview` hook re-fetches
 * compiled HTML from the compile API independently, so removing it here
 * doesn't break rendering.
 *
 * `renderedHtml` is similarly large compiled output that the LLM doesn't need.
 */
function stripHeavyFields(result: DesignWorkspaceResult): DesignWorkspaceResult {
  if (!result.data) {
    return result;
  }
  const { previewHtml, renderedHtml, ...lightData } = result.data;
  return { ...result, data: lightData };
}

async function executeDesignWorkspace(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  let result: DesignWorkspaceResult;

  switch (input.action) {
    case "open":
      result = await handleOpen(options);
      break;
    case "install":
      result = await handleInstall(options, input);
      break;
    case "generate":
      result = await handleGenerate(options, input);
      break;
    case "edit":
      result = await handleEdit(options, input);
      break;
    case "snapshot":
      result = handleSnapshot(options, input);
      break;
    case "restore":
      result = await handleRestore(options, input);
      break;
    case "export":
      result = await handleExport(options, input);
      break;
    case "close":
      result = handleClose(options);
      break;
    default:
      result = { success: false, action: String(input.action), error: `Unknown action: ${input.action}` };
  }

  return stripHeavyFields(result);
}

export function createDesignWorkspaceTool(options: DesignWorkspaceToolOptions = {}) {
  const executeWithLogging = withToolLogging(
    "designWorkspace",
    options.sessionId,
    async (input: DesignWorkspaceInput) => executeDesignWorkspace(options, input),
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

async function handleOpen(options: DesignWorkspaceToolOptions): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  const libraries = await getAvailableLibraries();
  const available = libraries.filter((library) => library.available).map((library) => library.package);
  const config = getWorkspaceConfig();
  const history = peekDesignHistory(sessionId);

  recordHistory(sessionId, "open", startedAt, true, {
    metadata: {
      availableLibraries: available,
    },
  });

  return {
    success: true,
    action: "open",
    data: {
      message: "Design workspace opened.",
      availableLibraries: available.length > 0 ? available : undefined,
      config,
      history: history ?? undefined,
    },
  };
}

async function handleInstall(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  const packages = input.packages?.filter((pkg) => typeof pkg === "string" && pkg.trim());
  if (!packages || packages.length === 0) {
    const error = 'Provide a "packages" array with at least one npm package name.';
    recordHistory(sessionId, "install", startedAt, false, { error });
    return {
      success: false,
      action: "install",
      error,
    };
  }

  const installResult = await installSandboxPackages(packages);
  resetAvailableLibrariesCache();
  const libraries = await getAvailableLibraries();
  const available = libraries.filter((library) => library.available).map((library) => library.package);

  if (!installResult.success) {
    const error = installResult.error || "npm install failed.";
    recordHistory(sessionId, "install", startedAt, false, {
      error,
      metadata: { packages: installResult.packageNames },
    });
    return {
      success: false,
      action: "install",
      error,
      data: {
        availableLibraries: available.length > 0 ? available : undefined,
        missingPackages: installResult.packageNames,
        autoRecoveryAttempted: installResult.attempted,
        autoRecoveryResult: "failed",
      },
    };
  }

  recordHistory(sessionId, "install", startedAt, true, {
    metadata: { packages: installResult.packageNames },
  });

  return {
    success: true,
    action: "install",
    data: {
      message: `Successfully installed: ${installResult.packageNames.join(", ")}`,
      availableLibraries: available.length > 0 ? available : undefined,
      autoRecoveryAttempted: installResult.attempted,
      autoRecoveryResult: installResult.attempted ? "success" : "not-needed",
    },
  };
}

async function handleGenerate(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  const { prompt, mode = "tailwind", style = "default", assets: inputAssets } = input;
  if (!prompt?.trim() && !input.code?.trim()) {
    const error = 'Provide either "prompt" (for AI generation) or "code" (for direct rendering).';
    recordHistory(sessionId, "generate", startedAt, false, { error });
    return { success: false, action: "generate", error };
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
    const error = generationError ?? "Generation produced empty output. Try a different prompt.";
    recordHistory(sessionId, "generate", startedAt, false, { error });
    return {
      success: false,
      action: "generate",
      error,
    };
  }

  const componentId = generateId();
  const name = input.code?.trim() ? "Direct Component" : "Generated Component";
  cacheComponent(sessionId, componentId, finalCode);

  const previewResult = await compilePreviewForTool(finalCode, name, "design-workspace-generate");
  const libraries = await getAvailableLibraries();
  const availableLibraries = libraries.filter((library) => library.available).map((library) => library.package);
  const baseData: DesignWorkspaceResultData = {
    componentId,
    code: finalCode,
    name,
    prompt: prompt?.trim() || undefined,
    mode,
    style,
    availableLibraries: availableLibraries.length > 0 ? availableLibraries : undefined,
  };

  if (!previewResult.ok) {
    recordHistory(sessionId, "generate", startedAt, false, {
      componentId,
      error: previewResult.error,
      metadata: {
        missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
      },
    });
    return buildCompileFailureResult("generate", baseData, previewResult);
  }

  recordHistory(sessionId, "generate", startedAt, true, {
    componentId,
    metadata: {
      recovered: previewResult.compileReport.recovered,
    },
  });

  return {
    success: true,
    action: "generate",
    data: {
      ...baseData,
      message: `Component "${name}" generated successfully.`,
      previewHtml: previewResult.previewHtml,
      compileReport: previewResult.compileReport,
      missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
      autoRecoveryAttempted: Boolean(previewResult.compileReport.autoInstall?.attempted),
      autoRecoveryResult: previewResult.compileReport.autoInstall
        ? previewResult.compileReport.autoInstall.success
          ? "success"
          : "failed"
        : "not-needed",
    },
  };
}

async function handleEdit(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  const {
    editPrompt,
    style = "default",
    activeComponentCode,
    activeComponentId,
    assets: inputAssets,
  } = input;

  let sourceCode = activeComponentCode?.trim() || undefined;
  if (!sourceCode && activeComponentId) {
    sourceCode = getCachedComponent(sessionId, activeComponentId);
  }

  if (!editPrompt?.trim() && activeComponentCode?.trim()) {
    const finalCode = activeComponentCode.trim();
    if (activeComponentId) {
      cacheComponent(sessionId, activeComponentId, finalCode);
    }

    const previewResult = await compilePreviewForTool(
      finalCode,
      "Edited Component",
      "design-workspace-edit-direct",
    );
    const config = getWorkspaceConfig();
    const validation = previewResult.ok
      ? await runPostEditValidation(finalCode, config, { previewBuildPassed: true })
      : undefined;

    if (!previewResult.ok) {
      recordHistory(sessionId, "edit", startedAt, false, {
        componentId: activeComponentId,
        error: previewResult.error,
        metadata: {
          missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
        },
      });
      return buildCompileFailureResult(
        "edit",
        {
          componentId: activeComponentId,
          code: finalCode,
          config,
        },
        previewResult,
      );
    }

    const validationMessage = buildValidationMessage(validation);
    recordHistory(sessionId, "edit", startedAt, true, {
      componentId: activeComponentId,
      validation,
    });

    return {
      success: true,
      action: "edit",
      data: {
        componentId: activeComponentId,
        code: finalCode,
        message: validationMessage || "Component code replaced directly.",
        previewHtml: previewResult.previewHtml,
        compileReport: previewResult.compileReport,
        postEditValidation: validation,
        config,
      },
    };
  }

  if (!editPrompt?.trim()) {
    const error = 'Provide "editPrompt" for AI-driven editing, or "activeComponentCode" without "editPrompt" to directly replace the code.';
    recordHistory(sessionId, "edit", startedAt, false, { error });
    return { success: false, action: "edit", error };
  }

  if (!sourceCode) {
    const error = 'No component code available. Either pass "activeComponentCode" or ensure the component was generated in this session.';
    recordHistory(sessionId, "edit", startedAt, false, { error });
    return {
      success: false,
      action: "edit",
      error,
    };
  }

  const assets = inputAssets?.length ? await resolveAssets(inputAssets) : undefined;

  let finalCode = "";
  let editError: string | undefined;

  for await (const event of editCard({ code: sourceCode, editPrompt, style, assets })) {
    if (event.type === "complete") {
      finalCode = event.content;
    }
    if (event.type === "error") {
      editError = event.error.message;
    }
  }

  if (editError || !finalCode.trim()) {
    const error = editError ?? "Edit produced empty output. Try rephrasing the instruction.";
    recordHistory(sessionId, "edit", startedAt, false, {
      componentId: activeComponentId,
      error,
    });
    return {
      success: false,
      action: "edit",
      error,
    };
  }

  if (activeComponentId) {
    cacheComponent(sessionId, activeComponentId, finalCode);
  }

  const componentName = activeComponentId ? "Edited Component" : "Component";
  const previewResult = await compilePreviewForTool(finalCode, componentName, "design-workspace-edit");
  const config = getWorkspaceConfig();
  const validation = previewResult.ok
    ? await runPostEditValidation(finalCode, config, { previewBuildPassed: true })
    : undefined;

  if (!previewResult.ok) {
    recordHistory(sessionId, "edit", startedAt, false, {
      componentId: activeComponentId,
      error: previewResult.error,
      metadata: {
        missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
      },
    });
    return buildCompileFailureResult(
      "edit",
      {
        componentId: activeComponentId,
        code: finalCode,
        config,
      },
      previewResult,
    );
  }

  const validationMessage = buildValidationMessage(validation);
  recordHistory(sessionId, "edit", startedAt, true, {
    componentId: activeComponentId,
    validation,
  });

  return {
    success: true,
    action: "edit",
    data: {
      componentId: activeComponentId,
      code: finalCode,
      message: validationMessage || "Component edited successfully.",
      previewHtml: previewResult.previewHtml,
      compileReport: previewResult.compileReport,
      postEditValidation: validation,
      config,
    },
  };
}

function handleSnapshot(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): DesignWorkspaceResult {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  recordHistory(sessionId, "snapshot", startedAt, true, {
    metadata: {
      label: input.label,
    },
  });

  return {
    success: true,
    action: "snapshot",
    data: {
      message: input.label ? `Snapshot "${input.label}" requested.` : "Snapshot requested.",
      ...(input.label ? { name: input.label } : {}),
    },
  };
}

function handleRestore(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): DesignWorkspaceResult {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  if (!input.snapshotId) {
    const error = 'Missing required field "snapshotId" for restore action.';
    recordHistory(sessionId, "restore", startedAt, false, { error });
    return { success: false, action: "restore", error };
  }

  recordHistory(sessionId, "restore", startedAt, true, {
    metadata: { snapshotId: input.snapshotId },
  });

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
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  let activeComponentCode = input.activeComponentCode?.trim() || undefined;
  if (!activeComponentCode && input.activeComponentId) {
    activeComponentCode = getCachedComponent(sessionId, input.activeComponentId);
  }

  if (!activeComponentCode) {
    const error = 'No component code available. Either pass "activeComponentCode" or ensure the component was generated in this session.';
    recordHistory(sessionId, "export", startedAt, false, {
      componentId: input.activeComponentId,
      error,
    });
    return {
      success: false,
      action: "export",
      error,
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

    recordHistory(sessionId, "export", startedAt, true, {
      componentId: input.activeComponentId,
      metadata: {
        format: exportResult.format,
        fileName: exportResult.fileName,
      },
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
    const message = error instanceof Error ? error.message : "Export failed.";
    recordHistory(sessionId, "export", startedAt, false, {
      componentId: input.activeComponentId,
      error: message,
    });
    return {
      success: false,
      action: "export",
      error: message,
    };
  }
}

function handleClose(options: DesignWorkspaceToolOptions): DesignWorkspaceResult {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  recordHistory(sessionId, "close", startedAt, true);
  const history = finalizeDesignHistory(sessionId);

  return {
    success: true,
    action: "close",
    data: {
      message: "Design workspace closed.",
      history: history ?? undefined,
    },
  };
}
