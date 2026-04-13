/**
 * Design Workspace Tool
 *
 * Minimal iteration-first control surface for the design workspace.
 * The durable source of truth is persisted design source code plus preview,
 * not transient server cache state.
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
  buildDesignPreviewErrorHtml,
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
import { updateDesignComponent } from "../../design/gallery/queries";
import {
  findWorkspaceDesign,
  listWorkspaceDesigns,
  saveDesignComponentRecord,
  type DesignGalleryItem,
} from "../../design/gallery/service";
import fs from "fs/promises";
import path from "path";
import {
  buildInspectPromptText,
  type InspectMessageContext,
} from "../../design/workspace/inspect-context";
import { detectFramework, buildProjectStructure, validateProjectPath } from "@/lib/design/workspace/project-detection";
import type { FrameworkType } from "@/lib/design/workspace/project-detection";
import { createDesignWorktree, getActiveWorktree, cleanupDesignWorktree, getWorktreeDiff, type WorktreeInfo } from "@/lib/design/workspace/worktree-manager";
import { castProjectFile, recastAfterEdit, applyEditToWorktree, readWorktreeFile, syncBackChanges } from "@/lib/design/workspace/component-casting";
import { initializeRenderers } from "@/lib/design/workspace/framework-renderers/init";
import { rendererRegistry } from "@/lib/design/workspace/framework-renderers/registry";

// ---------------------------------------------------------------------------
// Cast Registry — session-scoped in-memory tracking for cast components
// Cast components are NOT persisted to the gallery DB; they live only as long
// as the session is active. This registry makes them discoverable via status,
// list, and readSource actions.
// ---------------------------------------------------------------------------

interface CastRegistryEntry {
  componentId: string;
  targetFile: string;
  castMode: "page" | "component" | "route";
  sourceCode: string;
  previewHtml: string;
  framework: string;
  lastCastAt: number;
}

const castRegistry = new Map<string, Map<string, CastRegistryEntry>>();

function getCastEntry(sessionId: string, componentId: string): CastRegistryEntry | null {
  return castRegistry.get(sessionId)?.get(componentId) ?? null;
}

function setCastEntry(sessionId: string, entry: CastRegistryEntry): void {
  if (!castRegistry.has(sessionId)) {
    castRegistry.set(sessionId, new Map());
  }
  castRegistry.get(sessionId)!.set(entry.componentId, entry);
}

function listCastEntries(sessionId: string): CastRegistryEntry[] {
  const entries = castRegistry.get(sessionId);
  return entries ? Array.from(entries.values()) : [];
}

function clearCastRegistry(sessionId: string): void {
  castRegistry.delete(sessionId);
}

interface DesignWorkspaceToolOptions {
  sessionId?: string;
  userId?: string;
  characterId?: string;
  /** Inspect context from the user's message, when available. */
  inspectContext?: InspectMessageContext | null;
}

export function getCachedComponent(_sessionId: string, _componentId: string): string | undefined {
  return undefined;
}

export function resolveComponentCode(_sessionId: string, code: string): string | null {
  return code.startsWith("cached:") ? null : code;
}

interface DesignWorkspaceInput {
  action: "open" | "generate" | "edit" | "patch" | "readSource" | "list" | "status" | "close" | "install" | "detect" | "browse" | "cast" | "sync-back";

  /** npm package names to install. Required for "install" action. */
  packages?: string[];

  prompt?: string;
  mode?: "tailwind";
  style?: "apple-glass" | "default";

  editPrompt?: string;
  activeComponentCode?: string;
  activeComponentId?: string;

  code?: string;
  assets?: Array<{ url: string; description?: string }>;

  /** String to find in the active component code. For "patch" action. */
  oldString?: string;
  /** Replacement string. For "patch" action. */
  newString?: string;
  /** Replace all occurrences (default: false). For "patch" action. */
  replaceAll?: boolean;

  /**
   * Array of sequential patches for multi-location edits (e.g., wrapping).
   * Each patch is applied in order to the result of the previous one.
   * For "patch" action. Use instead of oldString/newString when the edit
   * requires changes at multiple locations in the source.
   */
  patches?: Array<{ oldString: string; newString: string; replaceAll?: boolean }>;

  projectSourcePath?: string;
  targetFile?: string;
  castMode?: "page" | "component" | "route";
  frameworkOverride?: FrameworkType;
  routePath?: string;
  syncStrategy?: "merge" | "pr" | "cherry-pick";
  syncFiles?: string[];
  browseFilter?: "pages" | "components" | "layouts" | "styles" | "all";
}

interface ListedDesignSummary {
  id: string;
  name: string;
  source: "session" | "saved" | "cast";
  updatedAt?: string;
  isFavorite?: boolean;
}

interface DesignWorkspaceResultData {
  componentId?: string;
  code?: string;
  name?: string;
  message?: string;
  prompt?: string;
  mode?: string;
  style?: string;
  previewHtml?: string;
  availableLibraries?: string[];
  compileReport?: DesignWorkspaceCompileReport;
  postEditValidation?: DesignWorkspaceValidationResult;
  history?: DesignWorkspaceHistory;
  config?: DesignWorkspaceConfig;
  missingPackages?: string[];
  autoRecoveryAttempted?: boolean;
  autoRecoveryResult?: "success" | "failed" | "not-needed";
  agentErrorSummary?: string;
  components?: ListedDesignSummary[];
  status?: "available" | "missing" | "inline";
  storage?: {
    database: boolean;
    userScoped: boolean;
    sessionScoped: boolean;
  };
  recoveryHint?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  /** Project-mode fields */
  castFile?: string;
  castMode?: "page" | "component" | "route";
  rendererInfo?: {
    type: string;
    port?: number;
    baseUrl?: string;
  };
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

interface ResolvedDesignSource {
  component: DesignGalleryItem | null;
  code: string | null;
  inline: boolean;
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

function getSessionId(options: DesignWorkspaceToolOptions): string {
  return options.sessionId?.trim() || "UNSCOPED";
}

function getPersistedUserId(options: DesignWorkspaceToolOptions): string | undefined {
  const userId = options.userId?.trim();
  return userId && userId !== "UNSCOPED" ? userId : undefined;
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

function buildAgentErrorSummary(report: DesignWorkspaceCompileReport): string {
  const lines: string[] = [];

  if (report.errors.length > 0) {
    for (const err of report.errors.slice(0, 5)) {
      const loc = err.location ? ` (line ${err.location.line})` : "";
      const sug = err.suggestion ? ` → Fix: ${err.suggestion}` : "";
      lines.push(`[${err.type}]${loc} ${err.message}${sug}`);
    }
    if (report.errors.length > 5) {
      lines.push(`... and ${report.errors.length - 5} more errors`);
    }
  }

  const missing = report.dependencyCheck.missingPackages;
  if (missing.length > 0) {
    lines.push(`Missing packages: ${missing.join(", ")} — use action "install" to add them.`);
  }

  if (report.diagnostics?.length && lines.length === 0) {
    for (const diagnostic of report.diagnostics.slice(0, 3)) {
      const loc = diagnostic.location ? ` (line ${diagnostic.location.line})` : "";
      lines.push(`${diagnostic.text}${loc}`);
    }
    if (report.diagnostics.length > 3) {
      lines.push(`... and ${report.diagnostics.length - 3} more diagnostics`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "Compilation failed (no structured error details available).";
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
      agentErrorSummary: buildAgentErrorSummary(compileFailure.compileReport),
      autoRecoveryAttempted: Boolean(compileFailure.compileReport.autoInstall?.attempted),
      autoRecoveryResult: compileFailure.compileReport.autoInstall
        ? compileFailure.compileReport.autoInstall.success
          ? "success"
          : "failed"
        : "not-needed",
    },
  };
}

function buildMissingComponentError(componentId: string, action: "edit" | "patch" | "readSource" | "status"): string {
  return `Design "${componentId}" is not available for ${action}. Run action "list" to discover persisted designs for this session, or pass the latest source with "activeComponentCode".`;
}

async function resolveDesignSource(
  options: DesignWorkspaceToolOptions,
  input: Pick<DesignWorkspaceInput, "activeComponentCode" | "activeComponentId">,
): Promise<ResolvedDesignSource> {
  if (input.activeComponentCode?.trim()) {
    return {
      component: input.activeComponentId ? await findWorkspaceDesign({
        id: input.activeComponentId,
        userId: getPersistedUserId(options),
        sessionId: getSessionId(options),
      }) : null,
      code: input.activeComponentCode.trim(),
      inline: true,
    };
  }

  if (!input.activeComponentId) {
    return {
      component: null,
      code: null,
      inline: false,
    };
  }

  const component = await findWorkspaceDesign({
    id: input.activeComponentId,
    userId: getPersistedUserId(options),
    sessionId: getSessionId(options),
  });

  return {
    component,
    code: component?.code ?? null,
    inline: false,
  };
}

async function persistNewDesign(
  options: DesignWorkspaceToolOptions,
  input: {
    id: string;
    name: string;
    prompt: string;
    code: string;
    mode: string;
    style: string;
  },
): Promise<DesignGalleryItem> {
  const userId = getPersistedUserId(options);
  if (!userId) {
    throw new Error("Design workspace requires an authenticated user context to persist generated source.");
  }

  return saveDesignComponentRecord({
    id: input.id,
    userId,
    characterId: options.characterId,
    sessionId: getSessionId(options),
    name: input.name,
    prompt: input.prompt,
    code: input.code,
    mode: input.mode,
    style: input.style,
    framework: "react-tailwind",
    category: "workspace",
  });
}

async function persistExistingDesign(
  component: DesignGalleryItem,
  updates: {
    code: string;
    prompt?: string;
    name?: string;
    mode?: string;
    style?: string;
    sessionId?: string;
    characterId?: string;
  },
): Promise<DesignGalleryItem> {
  const updated = await updateDesignComponent(component.userId, component.id, {
    code: updates.code,
    prompt: updates.prompt,
    name: updates.name,
    mode: updates.mode,
    style: updates.style,
    sessionId: updates.sessionId,
    characterId: updates.characterId,
  });

  if (!updated) {
    throw new Error(`Failed to persist design "${component.id}".`);
  }

  return {
    ...updated,
    previewUrl: component.previewUrl,
  };
}

function stripHeavyFields(result: DesignWorkspaceResult): DesignWorkspaceResult {
  if (!result.data) {
    return result;
  }

  const HEAVY_THRESHOLD = 5_000;
  const { previewHtml, renderedHtml: _renderedHtml, ...lightData } = result.data as DesignWorkspaceResultData & {
    renderedHtml?: string;
  };

  const keep: Record<string, unknown> = {};
  if (previewHtml && previewHtml.length < HEAVY_THRESHOLD) {
    keep.previewHtml = previewHtml;
  }

  return { ...result, data: { ...lightData, ...keep } };
}

async function executeDesignWorkspace(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  initializeRenderers();
  let result: DesignWorkspaceResult;
  const sessionId = getSessionId(options);
  const config = getWorkspaceConfig();

  switch (input.action) {
    case "open":
      result = await handleOpen(options, input);
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
    case "patch":
      result = await handlePatch(options, input);
      break;
    case "readSource":
      result = await handleReadSource(options, input);
      break;
    case "list":
      result = await handleList(options);
      break;
    case "status":
      result = await handleStatus(options, input);
      break;
    case "close":
      result = await handleClose(options);
      break;
    case "detect":
      result = await handleDetect(input, sessionId);
      break;
    case "browse":
      result = await handleBrowse(input, sessionId);
      break;
    case "cast":
      result = await handleCast(input, sessionId, config);
      break;
    case "sync-back":
      result = await handleSyncBack(input, sessionId);
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
    description: `Control the design workspace to generate, inspect, and iterate on UI components using code + preview.

**Actions:**
- "open": Open the design workspace panel.
- "install": Install npm packages for use in designs. Provide \`packages\` array (e.g. ["three", "@react-three/fiber"]).
- "generate": Generate a new UI component. Provide \`code\` (direct TSX) to render your own code, OR \`prompt\` for AI generation. Optional: \`mode\`, \`style\`, \`assets\`.
- "edit": Edit a persisted component. Provide \`activeComponentId\`. Provide \`activeComponentCode\` WITHOUT \`editPrompt\` to directly replace the code, OR provide \`editPrompt\` for AI-driven full-file rewriting.
- "patch": Surgically edit a persisted component using exact find-and-replace. Requires \`activeComponentId\`. Use \`oldString\` + \`newString\` for single-location edits, or \`patches\` array for multi-location edits (e.g., wrapping content in a new parent element requires inserting both an opening and closing tag). For wrapping operations, include the full block being wrapped in \`oldString\` and the wrapped version in \`newString\`, OR use \`patches\` to apply sequential insertions atomically.
- "readSource": Read back the source code of a persisted component. Pass \`activeComponentId\`.
- "list": List designs available to the current workspace session.
- "status": Inspect whether a design is persisted and available. Pass \`activeComponentId\`.
- "close": Close the design workspace panel.
- "detect": Detect framework and project structure from a local project path. Provide \`projectSourcePath\`.
- "browse": Browse pages, components, layouts, and styles in a detected project. Provide \`projectSourcePath\` and optional \`browseFilter\`.
- "cast": Cast a project file into the design workspace for live preview. Provide \`targetFile\` (relative path), optional \`castMode\` ("page"|"component"|"route"), and \`projectSourcePath\`.
- "sync-back": Sync worktree changes back to the original project. Provide \`projectSourcePath\` and optional \`syncStrategy\` ("merge"|"pr"|"cherry-pick").`,
    inputSchema: jsonSchema<DesignWorkspaceInput>({
      type: "object",
      title: "DesignWorkspaceInput",
      description: "Input for design workspace operations",
      properties: {
        action: {
          type: "string",
          enum: ["open", "generate", "edit", "patch", "readSource", "list", "status", "close", "install", "detect", "browse", "cast", "sync-back"],
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
          description: 'Generation mode (always "tailwind"). Optional for "generate".',
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
          description: 'Component code override. Optional for direct replacement or explicit source-driven edits.',
        },
        activeComponentId: {
          type: "string",
          description: 'ID of the persisted component to edit, patch, inspect, or read.',
        },
        oldString: {
          type: "string",
          description: 'The exact text to find in the component code. Required for "patch" action.',
        },
        newString: {
          type: "string",
          description: 'The replacement text. Required for "patch" action.',
        },
        replaceAll: {
          type: "boolean",
          description: 'If true, replace all occurrences of oldString. Default: false (replace first occurrence only). For "patch" action.',
        },
        patches: {
          type: "array",
          description: 'Array of sequential patches for multi-location edits. Each patch has oldString, newString, and optional replaceAll. Applied in order. Use instead of oldString/newString when wrapping content or making changes at multiple source locations. For "patch" action.',
          items: {
            type: "object",
            properties: {
              oldString: { type: "string", description: "The exact text to find." },
              newString: { type: "string", description: "The replacement text." },
              replaceAll: { type: "boolean", description: "Replace all occurrences. Default: false." },
            },
            required: ["oldString", "newString"],
            additionalProperties: false,
          },
        },
        projectSourcePath: {
          type: "string",
          description: "Absolute path to the synced folder / project root. Used with 'detect', 'cast', and 'open' (for project mode).",
        },
        targetFile: {
          type: "string",
          description: "Target file path relative to project root. Used with 'cast' action.",
        },
        castMode: {
          type: "string",
          enum: ["page", "component", "route"],
          description: "How to render the target: as a full page, isolated component, or by route. Used with 'cast'.",
        },
        frameworkOverride: {
          type: "string",
          description: "Override auto-detected framework type.",
        },
        syncStrategy: {
          type: "string",
          enum: ["merge", "pr", "cherry-pick"],
          description: "Strategy for syncing worktree changes back to source. Used with 'sync-back'.",
        },
        syncFiles: {
          type: "array",
          items: { type: "string" },
          description: "Specific files to sync back (for cherry-pick strategy).",
        },
        browseFilter: {
          type: "string",
          enum: ["pages", "components", "layouts", "styles", "all"],
          description: "Filter for browsing project structure. Used with 'browse'.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    }),
    execute: executeWithLogging,
  });
}

// ---------------------------------------------------------------------------
// Project-native action handlers
// ---------------------------------------------------------------------------

async function handleDetect(
  input: DesignWorkspaceInput,
  sessionId: string,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  ensureHistory(sessionId);
  const projectPath = input.projectSourcePath;
  if (!projectPath) {
    return { success: false, action: "detect", error: "projectSourcePath is required for detect action." };
  }

  try {
    const validation = await validateProjectPath(projectPath);
    if (!validation.valid) {
      return { success: false, action: "detect", error: `Invalid project path: ${validation.reason}` };
    }

    const framework = await detectFramework(projectPath);
    const structure = await buildProjectStructure(projectPath, framework.type);

    recordDesignHistory(sessionId, {
      action: "open", // recorded as open since detect initializes context
      durationMs: Date.now() - startedAt,
      success: true,
      metadata: { subAction: "detect", projectPath, framework: framework.type },
    });

    return {
      success: true,
      action: "detect",
      data: {
        message: `Detected ${framework.type} project (${framework.buildTool} build, ${framework.cssFramework} CSS, ${framework.packageManager} package manager).`,
        config: undefined as any, // not needed for detect
        // Encode project info in metadata-style fields
        prompt: JSON.stringify({ framework, structure }, null, 2),
      },
    };
  } catch (error) {
    return {
      success: false,
      action: "detect",
      error: `Detection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleBrowse(
  input: DesignWorkspaceInput,
  sessionId: string,
): Promise<DesignWorkspaceResult> {
  ensureHistory(sessionId);
  const projectPath = input.projectSourcePath;
  if (!projectPath) {
    return { success: false, action: "browse", error: "projectSourcePath is required for browse action." };
  }

  try {
    const framework = await detectFramework(projectPath);
    const structure = await buildProjectStructure(projectPath, framework.type);
    const filter = input.browseFilter ?? "all";

    let entries: Array<{ path: string; name: string; route?: string; type: string }> = [];
    if (filter === "all" || filter === "pages") entries.push(...structure.pages);
    if (filter === "all" || filter === "components") entries.push(...structure.components);
    if (filter === "all" || filter === "layouts") entries.push(...structure.layouts);
    if (filter === "all" || filter === "styles") entries.push(...structure.styles);

    return {
      success: true,
      action: "browse",
      data: {
        message: `Found ${entries.length} entries (${structure.pages.length} pages, ${structure.components.length} components, ${structure.layouts.length} layouts, ${structure.styles.length} styles).`,
        prompt: JSON.stringify(entries, null, 2),
      },
    };
  } catch (error) {
    return {
      success: false,
      action: "browse",
      error: `Browse failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleCast(
  input: DesignWorkspaceInput,
  sessionId: string,
  config: DesignWorkspaceConfig,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  ensureHistory(sessionId);
  const targetFile = input.targetFile;
  const castMode = input.castMode ?? "page";

  if (!targetFile) {
    return { success: false, action: "cast", error: "targetFile is required for cast action." };
  }

  try {
    // Ensure worktree exists — if not, need to detect + create first
    let worktree = getActiveWorktree(sessionId);
    if (!worktree && input.projectSourcePath) {
      worktree = await createDesignWorktree(input.projectSourcePath, sessionId);
    }
    if (!worktree) {
      return { success: false, action: "cast", error: "No active worktree. Provide projectSourcePath or run 'detect' first." };
    }

    // Detect framework
    const framework = input.frameworkOverride ?? (await detectFramework(worktree.worktreePath)).type;

    const result = await castProjectFile(sessionId, targetFile, castMode, framework, config);

    // Extract renderer info for C14 — populate RendererInfo in the result
    let rendererInfo: DesignWorkspaceResultData["rendererInfo"];
    const activeRenderer = rendererRegistry.getActiveRenderer(worktree.worktreePath);
    if (activeRenderer) {
      rendererInfo = {
        type: activeRenderer.tier === "dev-server" ? "dev-server" : "esbuild",
      };
      // Extract port/baseUrl from proxyUrl if available in the cast result
      if (result.previewHtml) {
        const proxyMatch = result.previewHtml.match(/src="(https?:\/\/127\.0\.0\.1:(\d+)[^"]*)"/);
        if (proxyMatch) {
          rendererInfo.port = parseInt(proxyMatch[2], 10);
          rendererInfo.baseUrl = `http://127.0.0.1:${proxyMatch[2]}`;
        }
      }
    }

    // Register in cast registry so status/list/readSource can find it
    setCastEntry(sessionId, {
      componentId: result.componentId,
      targetFile,
      castMode,
      sourceCode: result.sourceCode,
      previewHtml: result.previewHtml,
      framework: typeof framework === 'string' ? framework : 'unknown',
      lastCastAt: Date.now(),
    });

    recordDesignHistory(sessionId, {
      action: "generate", // cast is conceptually like generate
      componentId: result.componentId,
      durationMs: Date.now() - startedAt,
      success: true,
      metadata: { subAction: "cast", targetFile, castMode, framework },
    });

    return {
      success: true,
      action: "cast",
      data: {
        componentId: result.componentId,
        code: result.sourceCode,
        previewHtml: result.previewHtml,
        compileReport: result.compileReport,
        message: `Cast ${targetFile} as ${castMode} (${framework}).`,
        castFile: targetFile,
        castMode,
        rendererInfo,
      },
    };
  } catch (error) {
    recordDesignHistory(sessionId, {
      action: "generate",
      durationMs: Date.now() - startedAt,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: { subAction: "cast", targetFile, castMode },
    });
    return {
      success: false,
      action: "cast",
      error: `Cast failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleSyncBack(
  input: DesignWorkspaceInput,
  sessionId: string,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  ensureHistory(sessionId);
  const strategy = input.syncStrategy ?? "merge";

  try {
    const worktree = getActiveWorktree(sessionId);
    if (!worktree) {
      return { success: false, action: "sync-back", error: "No active worktree for this session." };
    }

    // Determine source root — the original project, not the worktree
    // We need the projectSourcePath or derive it from worktree metadata
    const sourceRoot = input.projectSourcePath;
    if (!sourceRoot) {
      return { success: false, action: "sync-back", error: "projectSourcePath is required for sync-back." };
    }

    const result = await syncBackChanges(sessionId, sourceRoot, strategy, input.syncFiles);

    recordDesignHistory(sessionId, {
      action: "close", // sync-back is conceptually a finalization
      durationMs: Date.now() - startedAt,
      success: result.success,
      metadata: { subAction: "sync-back", strategy, appliedFiles: result.appliedFiles },
    });

    return {
      success: result.success,
      action: "sync-back",
      data: {
        message: result.success
          ? `Synced ${result.appliedFiles.length} files back to source (${strategy}).`
          : `Sync-back failed: ${result.error}`,
        prompt: result.diff, // Include diff in response
      },
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      action: "sync-back",
      error: `Sync-back failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleOpen(options: DesignWorkspaceToolOptions, input?: DesignWorkspaceInput): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  const libraries = await getAvailableLibraries();
  const available = libraries.filter((library) => library.available).map((library) => library.package);
  const config = getWorkspaceConfig();
  const history = peekDesignHistory(sessionId);

  // Project-native mode: detect framework and create worktree
  let metadata: Record<string, unknown> | undefined;
  if (input?.projectSourcePath) {
    try {
      const validation = await validateProjectPath(input.projectSourcePath);
      if (validation.valid) {
        const framework = await detectFramework(input.projectSourcePath);
        const structure = await buildProjectStructure(input.projectSourcePath, framework.type);
        const worktree = await createDesignWorktree(input.projectSourcePath, sessionId);

        // Include project info in the response
        metadata = {
          framework,
          structure,
          worktreePath: worktree.worktreePath,
          worktreeBranch: worktree.branch,
        };
      }
    } catch (projectError) {
      // Non-fatal: log but continue with sandbox mode
      console.warn("[design-workspace] Project detection failed, falling back to sandbox:", projectError);
    }
  }

  recordHistory(sessionId, "open", startedAt, true, {
    metadata: {
      availableLibraries: available,
      ...metadata,
    },
  });

  return {
    success: true,
    action: "open",
    data: {
      message: metadata ? "Design workspace opened in project mode." : "Design workspace opened.",
      availableLibraries: available.length > 0 ? available : undefined,
      config,
      history: history ?? undefined,
      metadata,
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

  let persisted: DesignGalleryItem;
  try {
    persisted = await persistNewDesign(options, {
      id: componentId,
      name,
      prompt: prompt?.trim() || input.code?.trim() || "",
      code: finalCode,
      mode,
      style,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist generated design.";
    recordHistory(sessionId, "generate", startedAt, false, { error: message });
    return {
      success: false,
      action: "generate",
      error: message,
      data: {
        componentId,
        code: finalCode,
        name,
        mode,
        style,
      },
    };
  }

  const previewResult = await compilePreviewForTool(finalCode, persisted.name, "design-workspace-generate");
  const libraries = await getAvailableLibraries();
  const availableLibraries = libraries.filter((library) => library.available).map((library) => library.package);
  const baseData: DesignWorkspaceResultData = {
    componentId: persisted.id,
    code: finalCode,
    name: persisted.name,
    prompt: persisted.prompt,
    mode,
    style,
    availableLibraries: availableLibraries.length > 0 ? availableLibraries : undefined,
    updatedAt: persisted.updatedAt,
  };

  if (!previewResult.ok) {
    recordHistory(sessionId, "generate", startedAt, false, {
      componentId: persisted.id,
      error: previewResult.error,
      metadata: {
        missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
      },
    });
    return buildCompileFailureResult("generate", baseData, previewResult);
  }

  recordHistory(sessionId, "generate", startedAt, true, {
    componentId: persisted.id,
    metadata: {
      recovered: previewResult.compileReport.recovered,
    },
  });

  return {
    success: true,
    action: "generate",
    data: {
      ...baseData,
      message: `Design "${persisted.name}" generated and saved successfully.`,
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

  // ── Project-mode branch: edit worktree file instead of gallery design ──
  const worktree = getActiveWorktree(sessionId);
  if (worktree && input.targetFile) {
    return handleEditProjectMode(options, input, sessionId, startedAt, worktree);
  }

  if (!activeComponentId) {
    const error = 'Provide "activeComponentId" to edit a persisted design.';
    recordHistory(sessionId, "edit", startedAt, false, { error });
    return { success: false, action: "edit", error };
  }

  const resolved = await resolveDesignSource(options, { activeComponentId, activeComponentCode });
  if (!resolved.code || !resolved.component) {
    const error = buildMissingComponentError(activeComponentId, "edit");
    recordHistory(sessionId, "edit", startedAt, false, { componentId: activeComponentId, error });
    return {
      success: false,
      action: "edit",
      error,
      data: {
        componentId: activeComponentId,
        status: "missing",
        recoveryHint: 'Run action "list" to inspect persisted designs, or pass explicit source with "activeComponentCode".',
      },
    };
  }

  if (!editPrompt?.trim() && !activeComponentCode?.trim()) {
    const error = 'Provide "editPrompt" for AI-driven editing, or provide "activeComponentCode" to directly replace the design source.';
    recordHistory(sessionId, "edit", startedAt, false, { componentId: activeComponentId, error });
    return { success: false, action: "edit", error };
  }

  let finalCode = activeComponentCode?.trim() || "";
  if (!finalCode) {
    const assets = inputAssets?.length ? await resolveAssets(inputAssets) : undefined;
    let editError: string | undefined;

    // Enrich edit prompt with inspect context when the user selected elements.
    // The AI model already sees [Inspect Focus] in the user message via content-extractor,
    // but we also inject it here so the edit pipeline sees element selectors directly.
    let enrichedEditPrompt = editPrompt!;
    if (options.inspectContext) {
      const inspectPromptText = buildInspectPromptText(options.inspectContext);
      if (inspectPromptText) {
        enrichedEditPrompt = `${inspectPromptText}\n\n${enrichedEditPrompt}`;
      }
    }

    for await (const event of editCard({ code: resolved.code, editPrompt: enrichedEditPrompt, style, assets })) {
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
  }

  let persisted: DesignGalleryItem;
  try {
    persisted = await persistExistingDesign(resolved.component, {
      code: finalCode.trim(),
      prompt: editPrompt?.trim() || resolved.component.prompt,
      style,
      sessionId,
      characterId: options.characterId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist edited design.";
    recordHistory(sessionId, "edit", startedAt, false, {
      componentId: activeComponentId,
      error: message,
    });
    return {
      success: false,
      action: "edit",
      error: message,
      data: {
        componentId: activeComponentId,
        code: finalCode.trim(),
      },
    };
  }

  const previewResult = await compilePreviewForTool(finalCode.trim(), persisted.name, "design-workspace-edit");
  const config = getWorkspaceConfig();
  const validation = await runPostEditValidation(finalCode.trim(), config, { previewBuildPassed: previewResult.ok });
  const baseData: DesignWorkspaceResultData = {
    componentId: persisted.id,
    code: finalCode.trim(),
    name: persisted.name,
    prompt: persisted.prompt,
    style: persisted.style as "apple-glass" | "default",
    config,
    updatedAt: persisted.updatedAt,
  };

  if (!previewResult.ok) {
    recordHistory(sessionId, "edit", startedAt, false, {
      componentId: persisted.id,
      validation,
      error: previewResult.error,
      metadata: {
        missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
      },
    });
    return buildCompileFailureResult("edit", {
      ...baseData,
      postEditValidation: validation,
    }, previewResult);
  }

  const validationMessage = buildValidationMessage(validation);
  recordHistory(sessionId, "edit", startedAt, true, {
    componentId: persisted.id,
    validation,
  });

  return {
    success: true,
    action: "edit",
    data: {
      ...baseData,
      message: validationMessage || "Design edited successfully.",
      previewHtml: previewResult.previewHtml,
      compileReport: previewResult.compileReport,
      postEditValidation: validation,
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

/**
 * Lightweight JSX tag-balance check. Counts self-closing and open/close tags
 * and returns the first unclosed tag name if the tree is unbalanced.
 * This is intentionally approximate — it catches the most common wrapping
 * mistake (inserting an opening tag without its closing counterpart) without
 * requiring a full parser.
 */
export function findUnclosedJsxTag(code: string): string | null {
  // Strip string literals and comments to avoid false positives
  const stripped = code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  // Match JSX tags: <Tag, </Tag, or self-closing />
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
      // Mismatched close — don't error, just skip (could be fragment)
    } else {
      // Opening tag
      stack.push(tagName);
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] : null;
}

async function handlePatch(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  const { oldString, newString, replaceAll: replaceAllOccurrences, activeComponentId, activeComponentCode, patches } = input;

  // ── Project-mode branch: patch worktree file instead of gallery design ──
  const worktree = getActiveWorktree(sessionId);
  if (worktree && input.targetFile) {
    return handlePatchProjectMode(options, input, sessionId, startedAt, worktree);
  }

  if (!activeComponentId) {
    const error = 'Provide "activeComponentId" to patch a persisted design.';
    recordHistory(sessionId, "patch", startedAt, false, { error });
    return { success: false, action: "patch", error };
  }

  // Build the list of patch operations — either from `patches` array or single oldString/newString
  type PatchOp = { oldString: string; newString: string; replaceAll?: boolean };
  let patchOps: PatchOp[];

  if (patches && Array.isArray(patches) && patches.length > 0) {
    // Multi-patch mode
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      if (!p.oldString && p.oldString !== "") {
        return { success: false, action: "patch", error: `patches[${i}]: "oldString" is required.` };
      }
      if (p.newString === undefined || p.newString === null) {
        return { success: false, action: "patch", error: `patches[${i}]: "newString" is required.` };
      }
      if (p.oldString === p.newString) {
        return { success: false, action: "patch", error: `patches[${i}]: "oldString" and "newString" are identical.` };
      }
    }
    patchOps = patches;
  } else {
    // Single-patch mode (backwards compatible)
    if (oldString === undefined || oldString === null) {
      return { success: false, action: "patch", error: '"oldString" is required for patch action (or provide "patches" array for multi-location edits).' };
    }
    if (newString === undefined || newString === null) {
      return { success: false, action: "patch", error: '"newString" is required for patch action.' };
    }
    if (oldString === newString) {
      return { success: false, action: "patch", error: '"oldString" and "newString" are identical — nothing to patch.' };
    }
    patchOps = [{ oldString, newString, replaceAll: replaceAllOccurrences }];
  }

  const resolved = await resolveDesignSource(options, { activeComponentId, activeComponentCode });
  if (!resolved.code || !resolved.component) {
    const error = buildMissingComponentError(activeComponentId, "patch");
    recordHistory(sessionId, "patch", startedAt, false, { componentId: activeComponentId, error });
    return {
      success: false,
      action: "patch",
      error,
      data: {
        componentId: activeComponentId,
        status: "missing",
        recoveryHint: 'Run action "readSource" before patching if you need the latest persisted source.',
      },
    };
  }

  // Apply patches sequentially
  let patchedCode = resolved.code;
  let totalReplacements = 0;

  for (let i = 0; i < patchOps.length; i++) {
    const op = patchOps[i];
    const occurrences = patchedCode.split(op.oldString).length - 1;

    if (occurrences === 0) {
      const patchLabel = patchOps.length > 1 ? ` (patches[${i}])` : "";
      return {
        success: false,
        action: "patch",
        error: `"oldString" not found in design source${patchLabel}. The text to replace must match exactly (including whitespace and indentation).${i > 0 ? ` Note: ${i} prior patch(es) were already applied — use "readSource" to see the current state.` : ""}`,
      };
    }

    if (occurrences > 1 && !op.replaceAll) {
      const patchLabel = patchOps.length > 1 ? ` (patches[${i}])` : "";
      return {
        success: false,
        action: "patch",
        error: `"oldString" found ${occurrences} times${patchLabel}. Set "replaceAll: true" to replace all, or provide a longer/more unique "oldString".`,
      };
    }

    patchedCode = op.replaceAll
      ? patchedCode.split(op.oldString).join(op.newString)
      : patchedCode.replace(op.oldString, op.newString);
    totalReplacements += op.replaceAll ? occurrences : 1;
  }

  // JSX balance check — catch wrapping mistakes before persisting
  const unclosedTag = findUnclosedJsxTag(patchedCode);
  if (unclosedTag) {
    return {
      success: false,
      action: "patch",
      error: `Patch produced unbalanced JSX: <${unclosedTag}> appears to be unclosed. For wrapping operations, include the full block being wrapped in "oldString" and the complete wrapped version (with both opening and closing tags) in "newString". Alternatively, use "patches" array to apply opening and closing tag insertions as separate sequential patches, or use the "edit" action for AI-driven full-file rewriting.`,
    };
  }

  let persisted: DesignGalleryItem;
  try {
    persisted = await persistExistingDesign(resolved.component, {
      code: patchedCode,
      sessionId,
      characterId: options.characterId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist patched design.";
    recordHistory(sessionId, "patch", startedAt, false, {
      componentId: activeComponentId,
      error: message,
    });
    return {
      success: false,
      action: "patch",
      error: message,
      data: {
        componentId: activeComponentId,
        code: patchedCode,
      },
    };
  }

  const previewResult = await compilePreviewForTool(patchedCode, persisted.name, "design-workspace-patch");
  const config = getWorkspaceConfig();
  const validation = await runPostEditValidation(patchedCode, config, { previewBuildPassed: previewResult.ok });
  const baseData: DesignWorkspaceResultData = {
    componentId: persisted.id,
    code: patchedCode,
    name: persisted.name,
    prompt: persisted.prompt,
    config,
    updatedAt: persisted.updatedAt,
  };

  if (!previewResult.ok) {
    recordHistory(sessionId, "patch", startedAt, false, {
      componentId: persisted.id,
      validation,
      error: previewResult.error,
      metadata: {
        missingPackages: previewResult.compileReport.dependencyCheck.missingPackages,
      },
    });
    return buildCompileFailureResult("patch", {
      ...baseData,
      postEditValidation: validation,
    }, previewResult);
  }

  const linesChanged = countChangedLines(resolved.code, patchedCode);
  const validationMessage = buildValidationMessage(validation);
  recordHistory(sessionId, "patch", startedAt, true, {
    componentId: persisted.id,
    validation,
  });

  return {
    success: true,
    action: "patch",
    data: {
      ...baseData,
      message: validationMessage || `Patch applied: ${totalReplacements} replacement${totalReplacements > 1 ? "s" : ""}${patchOps.length > 1 ? ` across ${patchOps.length} patches` : ""}, ~${linesChanged} line${linesChanged !== 1 ? "s" : ""} changed.`,
      previewHtml: previewResult.previewHtml,
      compileReport: previewResult.compileReport,
      postEditValidation: validation,
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

function countChangedLines(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let changed = 0;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}

async function handleReadSource(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const sessionId = getSessionId(options);
  const { activeComponentId, activeComponentCode } = input;

  if (activeComponentCode?.trim()) {
    return {
      success: true,
      action: "readSource",
      data: {
        componentId: activeComponentId,
        code: activeComponentCode.trim(),
        status: "inline",
        storage: {
          database: false,
          userScoped: Boolean(getPersistedUserId(options)),
          sessionScoped: sessionId !== "UNSCOPED",
        },
        message: "Inline design source retrieved.",
      },
    };
  }

  if (!activeComponentId) {
    return {
      success: false,
      action: "readSource",
      error: 'Provide "activeComponentId" to read back persisted design source.',
    };
  }

  // Check cast registry first (cast components aren't in the gallery DB)
  const castEntry = getCastEntry(sessionId, activeComponentId);
  if (castEntry) {
    return {
      success: true,
      action: "readSource",
      data: {
        componentId: castEntry.componentId,
        code: castEntry.sourceCode,
        name: castEntry.targetFile,
        status: "available",
        storage: {
          database: false,
          userScoped: Boolean(getPersistedUserId(options)),
          sessionScoped: true,
        },
        castFile: castEntry.targetFile,
        castMode: castEntry.castMode,
        message: `Cast component source retrieved (${castEntry.sourceCode.length} chars, ~${Math.ceil(castEntry.sourceCode.split("\n").length)} lines).`,
      },
    };
  }

  const component = await findWorkspaceDesign({
    id: activeComponentId,
    userId: getPersistedUserId(options),
    sessionId,
  });

  if (!component) {
    return {
      success: false,
      action: "readSource",
      error: buildMissingComponentError(activeComponentId, "readSource"),
      data: {
        componentId: activeComponentId,
        status: "missing",
        recoveryHint: 'Run action "list" to inspect persisted designs for this session.',
      },
    };
  }

  return {
    success: true,
    action: "readSource",
    data: {
      componentId: component.id,
      code: component.code,
      name: component.name,
      status: "available",
      storage: {
        database: true,
        userScoped: Boolean(getPersistedUserId(options) || component.userId),
        sessionScoped: component.sessionId === sessionId,
      },
      updatedAt: component.updatedAt,
      message: `Design source retrieved (${component.code.length} chars, ~${Math.ceil(component.code.split("\n").length)} lines).`,
    },
  };
}

async function handleList(options: DesignWorkspaceToolOptions): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  try {
    const components = await listWorkspaceDesigns({
      userId: getPersistedUserId(options),
      sessionId,
      limit: 100,
    });

    // Merge in cast registry entries (not in the gallery DB)
    const castEntries = listCastEntries(sessionId);
    const castSummaries: ListedDesignSummary[] = castEntries.map((entry) => ({
      id: entry.componentId,
      name: entry.targetFile,
      source: "cast" as const,
      updatedAt: new Date(entry.lastCastAt).toISOString(),
    }));

    // Deduplicate: cast entries override DB entries with the same ID
    const dbIds = new Set(castSummaries.map((c) => c.id));
    const dbSummaries: ListedDesignSummary[] = components
      .filter((component) => !dbIds.has(component.id))
      .map((component) => ({
        id: component.id,
        name: component.name,
        source: (component.sessionId === sessionId ? "session" : "saved") as "session" | "saved",
        updatedAt: component.updatedAt,
        isFavorite: component.isFavorite,
      }));

    const allComponents = [...castSummaries, ...dbSummaries];

    recordHistory(sessionId, "list", startedAt, true, {
      metadata: { count: allComponents.length, castCount: castSummaries.length },
    });

    return {
      success: true,
      action: "list",
      data: {
        components: allComponents,
        message: allComponents.length > 0
          ? `Found ${allComponents.length} design${allComponents.length === 1 ? "" : "s"} for this workspace (${castSummaries.length} cast, ${dbSummaries.length} persisted).`
          : "No designs found for this workspace.",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list persisted designs.";
    recordHistory(sessionId, "list", startedAt, false, { error: message });
    return {
      success: false,
      action: "list",
      error: message,
    };
  }
}

async function handleStatus(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  if (input.activeComponentCode?.trim()) {
    recordHistory(sessionId, "status", startedAt, true);
    return {
      success: true,
      action: "status",
      data: {
        componentId: input.activeComponentId,
        status: "inline",
        storage: {
          database: false,
          userScoped: Boolean(getPersistedUserId(options)),
          sessionScoped: sessionId !== "UNSCOPED",
        },
        message: "Inline design source provided; no persisted lookup was required.",
      },
    };
  }

  if (!input.activeComponentId) {
    const error = 'Provide "activeComponentId" to inspect design status.';
    recordHistory(sessionId, "status", startedAt, false, { error });
    return {
      success: false,
      action: "status",
      error,
    };
  }

  // Check cast registry first (cast components aren't in the gallery DB)
  const castEntry = getCastEntry(sessionId, input.activeComponentId);
  if (castEntry) {
    recordHistory(sessionId, "status", startedAt, true, {
      componentId: castEntry.componentId,
    });
    return {
      success: true,
      action: "status",
      data: {
        componentId: castEntry.componentId,
        name: castEntry.targetFile,
        status: "available",
        storage: {
          database: false,
          userScoped: Boolean(getPersistedUserId(options)),
          sessionScoped: true,
        },
        castFile: castEntry.targetFile,
        castMode: castEntry.castMode,
        message: `Cast component from ${castEntry.targetFile} (${castEntry.castMode}).`,
      },
    };
  }

  const component = await findWorkspaceDesign({
    id: input.activeComponentId,
    userId: getPersistedUserId(options),
    sessionId,
  });

  if (!component) {
    const error = buildMissingComponentError(input.activeComponentId, "status");
    recordHistory(sessionId, "status", startedAt, false, {
      componentId: input.activeComponentId,
      error,
    });
    return {
      success: false,
      action: "status",
      error,
      data: {
        componentId: input.activeComponentId,
        status: "missing",
        storage: {
          database: false,
          userScoped: Boolean(getPersistedUserId(options)),
          sessionScoped: sessionId !== "UNSCOPED",
        },
        recoveryHint: 'Run action "list" to inspect available persisted designs.',
      },
    };
  }

  recordHistory(sessionId, "status", startedAt, true, {
    componentId: component.id,
  });

  return {
    success: true,
    action: "status",
    data: {
      componentId: component.id,
      name: component.name,
      status: "available",
      storage: {
        database: true,
        userScoped: Boolean(getPersistedUserId(options) || component.userId),
        sessionScoped: component.sessionId === sessionId,
      },
      updatedAt: component.updatedAt,
      message: `Design "${component.name}" is persisted and ready for iteration.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Project-mode edit/patch handlers
// ---------------------------------------------------------------------------

async function handleEditProjectMode(
  options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
  sessionId: string,
  startedAt: number,
  worktree: WorktreeInfo,
): Promise<DesignWorkspaceResult> {
  const { editPrompt, style = "default", activeComponentCode, targetFile, assets: inputAssets } = input;

  if (!targetFile) {
    return { success: false, action: "edit", error: "targetFile is required for project-mode edit." };
  }

  // Read current source from worktree
  let currentCode: string;
  try {
    currentCode = await readWorktreeFile(sessionId, targetFile);
  } catch (err) {
    const error = `Failed to read worktree file: ${err instanceof Error ? err.message : String(err)}`;
    recordHistory(sessionId, "edit", startedAt, false, { error });
    return { success: false, action: "edit", error };
  }

  // Determine final code: direct replacement or AI-driven edit
  let finalCode = activeComponentCode?.trim() || "";
  if (!finalCode) {
    if (!editPrompt?.trim()) {
      const error = 'Provide "editPrompt" for AI-driven editing, or provide "activeComponentCode" to directly replace the source.';
      recordHistory(sessionId, "edit", startedAt, false, { error });
      return { success: false, action: "edit", error };
    }

    const assets = inputAssets?.length ? await resolveAssets(inputAssets) : undefined;
    let editError: string | undefined;

    let enrichedEditPrompt = editPrompt;
    if (options.inspectContext) {
      const inspectPromptText = buildInspectPromptText(options.inspectContext);
      if (inspectPromptText) {
        enrichedEditPrompt = `${inspectPromptText}\n\n${enrichedEditPrompt}`;
      }
    }

    for await (const event of editCard({ code: currentCode, editPrompt: enrichedEditPrompt, style, assets })) {
      if (event.type === "complete") finalCode = event.content;
      if (event.type === "error") editError = event.error.message;
    }

    if (editError || !finalCode.trim()) {
      const error = editError ?? "Edit produced empty output.";
      recordHistory(sessionId, "edit", startedAt, false, { error });
      return { success: false, action: "edit", error };
    }
  }

  // Write edited code to worktree and re-cast for preview
  try {
    const config = getWorkspaceConfig();
    const framework = input.frameworkOverride ?? (await detectFramework(worktree.worktreePath)).type;
    const castResult = await recastAfterEdit(sessionId, targetFile, finalCode.trim(), framework, config);

    recordHistory(sessionId, "edit", startedAt, true, {
      componentId: castResult.componentId,
      metadata: { subAction: "project-edit", targetFile },
    });

    return {
      success: true,
      action: "edit",
      data: {
        componentId: castResult.componentId,
        code: finalCode.trim(),
        name: targetFile,
        message: `Project file "${targetFile}" edited and re-cast successfully.`,
        previewHtml: castResult.previewHtml,
        compileReport: castResult.compileReport,
      },
    };
  } catch (err) {
    const error = `Project edit failed: ${err instanceof Error ? err.message : String(err)}`;
    recordHistory(sessionId, "edit", startedAt, false, { error, metadata: { targetFile } });
    return { success: false, action: "edit", error, data: { code: finalCode.trim() } };
  }
}

async function handlePatchProjectMode(
  _options: DesignWorkspaceToolOptions,
  input: DesignWorkspaceInput,
  sessionId: string,
  startedAt: number,
  worktree: WorktreeInfo,
): Promise<DesignWorkspaceResult> {
  const { oldString, newString, replaceAll: replaceAllOccurrences, targetFile, patches } = input;

  if (!targetFile) {
    return { success: false, action: "patch", error: "targetFile is required for project-mode patch." };
  }

  // Build patch operations
  type PatchOp = { oldString: string; newString: string; replaceAll?: boolean };
  let patchOps: PatchOp[];

  if (patches && Array.isArray(patches) && patches.length > 0) {
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      if (!p.oldString && p.oldString !== "") {
        return { success: false, action: "patch", error: `patches[${i}]: "oldString" is required.` };
      }
      if (p.newString === undefined || p.newString === null) {
        return { success: false, action: "patch", error: `patches[${i}]: "newString" is required.` };
      }
      if (p.oldString === p.newString) {
        return { success: false, action: "patch", error: `patches[${i}]: "oldString" and "newString" are identical.` };
      }
    }
    patchOps = patches;
  } else {
    if (oldString === undefined || oldString === null) {
      return { success: false, action: "patch", error: '"oldString" is required for patch action (or provide "patches" array).' };
    }
    if (newString === undefined || newString === null) {
      return { success: false, action: "patch", error: '"newString" is required for patch action.' };
    }
    if (oldString === newString) {
      return { success: false, action: "patch", error: '"oldString" and "newString" are identical.' };
    }
    patchOps = [{ oldString, newString, replaceAll: replaceAllOccurrences }];
  }

  // Read current source from worktree
  let currentCode: string;
  try {
    currentCode = await readWorktreeFile(sessionId, targetFile);
  } catch (err) {
    const error = `Failed to read worktree file: ${err instanceof Error ? err.message : String(err)}`;
    recordHistory(sessionId, "patch", startedAt, false, { error });
    return { success: false, action: "patch", error };
  }

  // Apply patches sequentially
  let patchedCode = currentCode;
  let totalReplacements = 0;

  for (let i = 0; i < patchOps.length; i++) {
    const op = patchOps[i];
    const occurrences = patchedCode.split(op.oldString).length - 1;

    if (occurrences === 0) {
      const patchLabel = patchOps.length > 1 ? ` (patches[${i}])` : "";
      return {
        success: false,
        action: "patch",
        error: `"oldString" not found in project file${patchLabel}.${i > 0 ? ` Note: ${i} prior patch(es) were already applied.` : ""}`,
      };
    }

    if (occurrences > 1 && !op.replaceAll) {
      const patchLabel = patchOps.length > 1 ? ` (patches[${i}])` : "";
      return {
        success: false,
        action: "patch",
        error: `"oldString" found ${occurrences} times${patchLabel}. Set "replaceAll: true" to replace all.`,
      };
    }

    patchedCode = op.replaceAll
      ? patchedCode.split(op.oldString).join(op.newString)
      : patchedCode.replace(op.oldString, op.newString);
    totalReplacements += op.replaceAll ? occurrences : 1;
  }

  // JSX balance check
  const unclosedTag = findUnclosedJsxTag(patchedCode);
  if (unclosedTag) {
    return {
      success: false,
      action: "patch",
      error: `Patch produced unbalanced JSX: <${unclosedTag}> appears to be unclosed.`,
    };
  }

  // Write patched code to worktree and re-cast
  try {
    const config = getWorkspaceConfig();
    const framework = input.frameworkOverride ?? (await detectFramework(worktree.worktreePath)).type;
    const castResult = await recastAfterEdit(sessionId, targetFile, patchedCode, framework, config);

    const linesChanged = countChangedLines(currentCode, patchedCode);
    recordHistory(sessionId, "patch", startedAt, true, {
      componentId: castResult.componentId,
      metadata: { subAction: "project-patch", targetFile, totalReplacements },
    });

    return {
      success: true,
      action: "patch",
      data: {
        componentId: castResult.componentId,
        code: patchedCode,
        name: targetFile,
        message: `Project file "${targetFile}" patched: ${totalReplacements} replacement${totalReplacements > 1 ? "s" : ""}, ~${linesChanged} line${linesChanged !== 1 ? "s" : ""} changed.`,
        previewHtml: castResult.previewHtml,
        compileReport: castResult.compileReport,
      },
    };
  } catch (err) {
    const error = `Project patch failed: ${err instanceof Error ? err.message : String(err)}`;
    recordHistory(sessionId, "patch", startedAt, false, { error, metadata: { targetFile } });
    return { success: false, action: "patch", error, data: { code: patchedCode } };
  }
}

async function handleClose(options: DesignWorkspaceToolOptions): Promise<DesignWorkspaceResult> {
  const startedAt = Date.now();
  const sessionId = getSessionId(options);
  ensureHistory(sessionId);

  // Shut down any active renderer for this session's worktree, then clean up the worktree
  try {
    const worktree = getActiveWorktree(sessionId);
    if (worktree) {
      // Kill dev-server / renderer processes before removing the worktree directory
      try { await rendererRegistry.shutdownRenderer(worktree.worktreePath); } catch { /* non-fatal */ }
      await cleanupDesignWorktree(sessionId);
    }
  } catch {
    // Non-fatal
  }

  clearCastRegistry(sessionId);
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
