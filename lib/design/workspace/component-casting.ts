/**
 * Component Casting
 *
 * Bridge between user project files and the design workspace preview.
 * Takes a project file, routes it through the appropriate framework
 * renderer, and produces preview HTML for the design workspace iframe.
 *
 * In direct mode the worktreePath points at the real project source, so
 * all file reads/writes and dev server execution happen in-place.
 */

import fs from "fs/promises";
import { realpathSync } from "fs";
import { resolve, sep } from "path";
import crypto from "crypto";
import type { FrameworkType, DetectedFramework } from "./project-detection";
import type { DesignWorkspaceConfig, DesignWorkspaceCompileReport } from "./config";
import type { RendererOutput } from "./framework-renderers/types";
import { rendererRegistry } from "./framework-renderers/registry";
import { getInspectorScript } from "./inspector-script";
import { getActiveWorktree } from "./worktree-manager";

// ---------------------------------------------------------------------------
// Path traversal guard
// ---------------------------------------------------------------------------

/**
 * Resolve `targetFile` against `worktreePath` and verify the result stays
 * inside the worktree. Prevents both `../` traversal and symlink-based
 * escapes by resolving through `realpathSync` when the target exists.
 */
function safeWorktreePath(worktreePath: string, targetFile: string): string {
  const resolved = resolve(worktreePath, targetFile);
  let canonical: string;
  try {
    canonical = realpathSync(resolved);
  } catch {
    canonical = resolved;
  }
  let rootCanonical: string;
  try {
    rootCanonical = realpathSync(worktreePath);
  } catch {
    rootCanonical = resolve(worktreePath);
  }
  const normalizedRoot = rootCanonical + sep;
  if (canonical !== rootCanonical && !canonical.startsWith(normalizedRoot)) {
    throw new Error(
      `Path traversal blocked: "${targetFile}" resolves outside the worktree root.`,
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CastResult {
  /** Generated component ID for the design workspace */
  componentId: string;
  /** Preview HTML to display in iframe */
  previewHtml: string;
  /** Source code of the cast file */
  sourceCode: string;
  /** The file that was cast (relative path) */
  castFile: string;
  /** How it was cast */
  castMode: "page" | "component" | "route";
  /** Compilation report from the renderer */
  compileReport?: DesignWorkspaceCompileReport;
  /** Full route-qualified proxy URL from the renderer (dev-server tier only).
   *  Includes framework-specific route mapping (fileToRoute, bladeToRoute). */
  rendererProxyUrl?: string;
}

export interface SyncBackResult {
  success: boolean;
  /** Git diff of all changes */
  diff: string;
  /** Files that were changed */
  appliedFiles: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Inspector script — uses shared module for the full-featured inspector
// ---------------------------------------------------------------------------

const INSPECTOR_SCRIPT = `<script data-selene-inspector="true">${getInspectorScript("active")}<\/script>`;

// ---------------------------------------------------------------------------
// Cast functions
// ---------------------------------------------------------------------------

/**
 * Cast a project file into the design workspace.
 *
 * Reads the target file from the project, compiles it through the
 * appropriate framework renderer, and returns preview HTML.
 */
export async function castProjectFile(
  sessionId: string,
  targetFile: string,
  castMode: "page" | "component" | "route",
  framework: FrameworkType | DetectedFramework,
  config: DesignWorkspaceConfig,
): Promise<CastResult> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  const fullPath = safeWorktreePath(worktree.worktreePath, targetFile);
  const sourceCode = await fs.readFile(fullPath, "utf-8");

  // Accept either a FrameworkType string or a full DetectedFramework object
  const frameworkInfo: DetectedFramework = typeof framework === "string"
    ? {
        type: framework,
        buildTool: "vite" as const,
        cssFramework: "unknown" as const,
        entryPoints: [targetFile],
        configFiles: [],
        packageManager: "npm" as const,
      }
    : framework;

  const ctx = {
    projectRoot: config.projectRoot ?? worktree.worktreePath,
    worktreePath: worktree.worktreePath,
    framework: frameworkInfo,
    config,
  };

  const renderer = await rendererRegistry.getOrStartRenderer(ctx);
  if (!renderer) {
    throw new Error(`No renderer available for framework: ${frameworkInfo.type}`);
  }

  let output: RendererOutput;
  try {
    output = await renderer.render(targetFile, castMode);
  } catch (err) {
    throw new Error(
      `Renderer failed for ${targetFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const previewHtml = buildPreviewHtml(output);
  const componentId = `design-project-${crypto.randomUUID()}`;

  return {
    componentId,
    previewHtml,
    sourceCode: output.sourceCode ?? sourceCode,
    castFile: targetFile,
    castMode,
    compileReport: output.compileReport,
    rendererProxyUrl: output.proxyUrl,
  };
}

/**
 * Re-cast after code changes were applied to the project.
 * Uses the renderer's rerender() for incremental updates.
 */
export async function recastAfterEdit(
  sessionId: string,
  targetFile: string,
  newCode: string,
  framework: FrameworkType | DetectedFramework,
  config: DesignWorkspaceConfig,
  castMode: "page" | "component" | "route" = "component",
): Promise<CastResult> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  // Write the new code to the project file before re-rendering
  const fullPath = safeWorktreePath(worktree.worktreePath, targetFile);
  await fs.writeFile(fullPath, newCode, "utf-8");

  const frameworkInfo: DetectedFramework = typeof framework === "string"
    ? {
        type: framework,
        buildTool: "vite" as const,
        cssFramework: "unknown" as const,
        entryPoints: [targetFile],
        configFiles: [],
        packageManager: "npm" as const,
      }
    : framework;

  const ctx = {
    projectRoot: config.projectRoot ?? worktree.worktreePath,
    worktreePath: worktree.worktreePath,
    framework: frameworkInfo,
    config,
  };

  const renderer = await rendererRegistry.getOrStartRenderer(ctx);
  if (!renderer) {
    throw new Error(`No renderer available for framework: ${frameworkInfo.type}`);
  }

  let output: RendererOutput;
  try {
    output = await renderer.rerender(targetFile, newCode);
  } catch (err) {
    throw new Error(
      `Re-render failed for ${targetFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const previewHtml = buildPreviewHtml(output);
  const componentId = `design-project-${crypto.randomUUID()}`;

  return {
    componentId,
    previewHtml,
    sourceCode: output.sourceCode ?? newCode,
    castFile: targetFile,
    castMode,
    compileReport: output.compileReport,
    rendererProxyUrl: output.proxyUrl,
  };
}

// ---------------------------------------------------------------------------
// Project file I/O
// ---------------------------------------------------------------------------

/**
 * Write changed code back to a project file.
 */
export async function applyEditToWorktree(
  sessionId: string,
  targetFile: string,
  newCode: string,
): Promise<void> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  const fullPath = safeWorktreePath(worktree.worktreePath, targetFile);
  try {
    await fs.writeFile(fullPath, newCode, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to write ${targetFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read the current source code of a cast file from the project.
 */
export async function readWorktreeFile(
  sessionId: string,
  targetFile: string,
): Promise<string> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  const fullPath = safeWorktreePath(worktree.worktreePath, targetFile);
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read ${targetFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sync back
// ---------------------------------------------------------------------------

/**
 * Sync changes back to the source project.
 *
 * In direct mode (the default) changes are already in the source directory,
 * so this is a no-op that returns immediately.
 */
export async function syncBackChanges(
  sessionId: string,
  _sourceRoot: string,
  _strategy: "merge" | "pr" | "cherry-pick",
  _files?: string[],
): Promise<SyncBackResult> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    return { success: false, diff: "", appliedFiles: [], error: "No active worktree for session" };
  }

  // Direct mode: changes are already in the source directory — nothing to sync.
  return {
    success: true,
    diff: "",
    appliedFiles: [],
  };
}

// ---------------------------------------------------------------------------
// Inspector injection
// ---------------------------------------------------------------------------

/**
 * Inject the design workspace inspector script into preview HTML.
 * The inspector allows element selection in the preview iframe.
 */
export function injectInspectorScript(html: string): string {
  if (html.includes("data-selene-inspector")) {
    return html;
  }

  const closingBodyIdx = html.lastIndexOf("</body>");
  if (closingBodyIdx !== -1) {
    return html.slice(0, closingBodyIdx) + INSPECTOR_SCRIPT + html.slice(closingBodyIdx);
  }
  return html + INSPECTOR_SCRIPT;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the final preview HTML from renderer output, injecting the
 * inspector script when the output includes direct HTML.
 */
function buildPreviewHtml(output: RendererOutput): string {
  if (output.html) {
    return injectInspectorScript(output.html);
  }

  if (output.proxyUrl) {
    // Dev-server renderers route through the InspectorProxy, which injects
    // the inspector script directly into HTML responses from the dev server.
    // Return empty string to signal the frontend to use rendererInfo.baseUrl
    // (src= on the iframe) instead of srcDoc.
    return "";
  }

  return injectInspectorScript(
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>No preview available.</p></body></html>`,
  );
}
