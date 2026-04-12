/**
 * Component Casting
 *
 * Bridge between user project files and the design workspace preview.
 * Takes a project file, routes it through the appropriate framework
 * renderer, and produces preview HTML for the design workspace iframe.
 * Also handles syncing changes back from the worktree to the source project.
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import { join, relative } from "path";
import crypto from "crypto";
import type { FrameworkType } from "./project-detection";
import type { DesignWorkspaceConfig, DesignWorkspaceCompileReport } from "./config";
import type { RendererOutput } from "./framework-renderers/types";
import { rendererRegistry } from "./framework-renderers/registry";
import { getActiveWorktree, getWorktreeDiff, loadSnapshotManifest } from "./worktree-manager";
import type { ManifestEntry } from "./worktree-manager";
import { runGitCommand } from "@/lib/workspace/git-runner";

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
}

export interface SyncBackResult {
  success: boolean;
  /** Git diff of all changes */
  diff: string;
  /** Files that were changed */
  appliedFiles: string[];
  /** Files that failed to sync */
  failedFiles?: string[];
  /** Files skipped due to source conflicts (source changed since worktree creation) */
  conflictFiles?: string[];
  /** PR URL if strategy was "pr" */
  prUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Inspector script
// ---------------------------------------------------------------------------

const INSPECTOR_SCRIPT = `
<script data-selene-inspector="true">
(function() {
  let inspectorEnabled = false;
  let hoveredElement = null;
  const overlay = document.createElement('div');
  overlay.id = '__selene_inspector_overlay__';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);display:none;';
  document.body.appendChild(overlay);

  window.addEventListener('message', function(e) {
    if (e.data?.type === 'selene:inspector:toggle') {
      inspectorEnabled = e.data.enabled;
      if (!inspectorEnabled) {
        overlay.style.display = 'none';
        hoveredElement = null;
      }
    }
  });

  document.addEventListener('mousemove', function(e) {
    if (!inspectorEnabled) return;
    var el = e.target;
    if (el === overlay || el === hoveredElement) return;
    hoveredElement = el;
    var rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  });

  document.addEventListener('click', function(e) {
    if (!inspectorEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    window.parent.postMessage({
      type: 'selene:inspector:select',
      element: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || '',
        className: el.className || '',
        textContent: (el.textContent || '').slice(0, 160),
        selector: buildSelector(el),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: {
          width: cs.width, height: cs.height,
          padding: cs.padding, margin: cs.margin,
          display: cs.display, position: cs.position,
          color: cs.color, backgroundColor: cs.backgroundColor,
          fontSize: cs.fontSize, fontFamily: cs.fontFamily,
        }
      }
    }, '*');
  }, true);

  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var selector = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      selector += '.' + el.className.trim().split(/\\s+/).slice(0, 3).map(function(c) { return CSS.escape(c); }).join('.');
    }
    return selector;
  }
})();
</script>`;

// ---------------------------------------------------------------------------
// Cast functions
// ---------------------------------------------------------------------------

/**
 * Cast a project file into the design workspace.
 *
 * Reads the target file from the worktree, compiles it through the
 * appropriate framework renderer, and returns preview HTML.
 */
export async function castProjectFile(
  sessionId: string,
  targetFile: string,
  castMode: "page" | "component" | "route",
  framework: FrameworkType,
  config: DesignWorkspaceConfig,
): Promise<CastResult> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  const fullPath = join(worktree.worktreePath, targetFile);
  const sourceCode = await fs.readFile(fullPath, "utf-8");

  const ctx = {
    projectRoot: config.projectRoot ?? worktree.worktreePath,
    worktreePath: worktree.worktreePath,
    framework: {
      type: framework,
      buildTool: "vite" as const,
      cssFramework: "unknown" as const,
      entryPoints: [targetFile],
      configFiles: [],
      packageManager: "npm" as const,
    },
    config,
  };

  const renderer = await rendererRegistry.getOrStartRenderer(ctx);
  if (!renderer) {
    throw new Error(`No renderer available for framework: ${framework}`);
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
  };
}

/**
 * Re-cast after code changes were applied to the worktree.
 * Uses the renderer's rerender() for incremental updates.
 */
export async function recastAfterEdit(
  sessionId: string,
  targetFile: string,
  newCode: string,
  framework: FrameworkType,
  config: DesignWorkspaceConfig,
  castMode: "page" | "component" | "route" = "component",
): Promise<CastResult> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  // Write the new code to the worktree file before re-rendering
  const fullPath = join(worktree.worktreePath, targetFile);
  await fs.writeFile(fullPath, newCode, "utf-8");

  const ctx = {
    projectRoot: config.projectRoot ?? worktree.worktreePath,
    worktreePath: worktree.worktreePath,
    framework: {
      type: framework,
      buildTool: "vite" as const,
      cssFramework: "unknown" as const,
      entryPoints: [targetFile],
      configFiles: [],
      packageManager: "npm" as const,
    },
    config,
  };

  const renderer = await rendererRegistry.getOrStartRenderer(ctx);
  if (!renderer) {
    throw new Error(`No renderer available for framework: ${framework}`);
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
  };
}

// ---------------------------------------------------------------------------
// Worktree file I/O
// ---------------------------------------------------------------------------

/**
 * Write changed code back to a worktree file.
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

  const fullPath = join(worktree.worktreePath, targetFile);
  try {
    await fs.writeFile(fullPath, newCode, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to write ${targetFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read the current source code of a cast file from the worktree.
 */
export async function readWorktreeFile(
  sessionId: string,
  targetFile: string,
): Promise<string> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    throw new Error("No active worktree for session");
  }

  const fullPath = join(worktree.worktreePath, targetFile);
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
 * Sync worktree changes back to the source project.
 *
 * Strategies:
 * - "merge": Apply diff directly to source branch
 * - "pr": Push worktree branch and create PR (requires gh CLI)
 * - "cherry-pick": Apply only selected files
 */
export async function syncBackChanges(
  sessionId: string,
  sourceRoot: string,
  strategy: "merge" | "pr" | "cherry-pick",
  files?: string[],
): Promise<SyncBackResult> {
  const worktree = getActiveWorktree(sessionId);
  if (!worktree) {
    return { success: false, diff: "", appliedFiles: [], error: "No active worktree for session" };
  }

  try {
    const diff = await getWorktreeDiff(sessionId);
    const worktreeCreatedAt = new Date(worktree.createdAt);

    if (strategy === "merge") {
      return await syncMerge(worktree.worktreePath, worktree.baseBranch, sourceRoot, worktree.isGitBased, diff, worktreeCreatedAt);
    }

    if (strategy === "pr") {
      return await syncPr(worktree.worktreePath, worktree.branch, worktree.baseBranch, diff);
    }

    if (strategy === "cherry-pick") {
      return await syncCherryPick(worktree.worktreePath, sourceRoot, diff, files, worktreeCreatedAt);
    }

    return { success: false, diff, appliedFiles: [], error: `Unknown strategy: ${strategy}` };
  } catch (err) {
    return {
      success: false,
      diff: "",
      appliedFiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Inspector injection
// ---------------------------------------------------------------------------

/**
 * Inject the design workspace inspector script into preview HTML.
 * The inspector allows element selection in the preview iframe.
 */
export function injectInspectorScript(html: string): string {
  // Skip injection if the inspector script is already present
  if (html.includes("data-selene-inspector")) {
    return html;
  }

  const closingBodyIdx = html.lastIndexOf("</body>");
  if (closingBodyIdx !== -1) {
    return html.slice(0, closingBodyIdx) + INSPECTOR_SCRIPT + html.slice(closingBodyIdx);
  }
  // No </body> tag found; append the script at the end
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
    // Wrap the dev-server proxy URL in a minimal HTML iframe shell
    return injectInspectorScript(
      `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design Preview</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,iframe{width:100%;height:100%;border:none}</style>
</head>
<body>
<iframe src="${output.proxyUrl}" style="width:100%;height:100%;border:none;" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</body>
</html>`,
    );
  }

  return injectInspectorScript(
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>No preview available.</p></body></html>`,
  );
}

interface ChangedFilesResult {
  /** Modified or added files */
  changed: string[];
  /** Deleted files (present in HEAD but removed in worktree) */
  deleted: string[];
}

/**
 * Get list of changed files in the worktree relative to its root.
 * Uses `git status --porcelain` to also catch untracked files, and
 * `git diff --diff-filter=D` to detect deletions.
 */
async function getChangedFiles(worktreePath: string): Promise<ChangedFilesResult> {
  try {
    // Use git status --porcelain to catch all changes including untracked files
    const statusOutput = await runGitCommand(
      worktreePath,
      ["status", "--porcelain"],
      undefined,
      "[design-cast]",
    );

    const changed: string[] = [];
    const deleted: string[] = [];

    for (const line of statusOutput.trim().split("\n").filter(Boolean)) {
      const statusCode = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      if (!filePath) continue;

      // 'D ' = staged deletion, ' D' = unstaged deletion
      if (statusCode.includes("D")) {
        deleted.push(filePath);
      } else {
        changed.push(filePath);
      }
    }

    return { changed, deleted };
  } catch {
    return { changed: [], deleted: [] };
  }
}

/**
 * Get changed files for a non-git worktree by comparing against the snapshot manifest.
 * Detects added, modified, and deleted files.
 */
async function getManifestChanges(worktreePath: string): Promise<ChangedFilesResult> {
  const manifest = await loadSnapshotManifest(worktreePath);
  if (!manifest) {
    // No manifest — cannot detect changes
    return { changed: [], deleted: [] };
  }

  const manifestMap = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) {
    manifestMap.set(entry.path, entry);
  }

  const changed: string[] = [];
  const deleted: string[] = [];

  // Walk current files to find added/modified
  const currentFiles = await walkWorktreeFiles(worktreePath, worktreePath);
  const currentPaths = new Set<string>();

  for (const file of currentFiles) {
    currentPaths.add(file.path);
    const original = manifestMap.get(file.path);
    if (!original) {
      // New file (added)
      changed.push(file.path);
    } else if (file.size !== original.size || file.mtime !== original.mtime) {
      // Modified file
      changed.push(file.path);
    }
  }

  // Find deleted files (in manifest but not in current)
  for (const entry of manifest.entries) {
    if (!currentPaths.has(entry.path)) {
      deleted.push(entry.path);
    }
  }

  return { changed, deleted };
}

/**
 * Walk files in a worktree directory for manifest comparison.
 * Mirrors the walkDirectory logic in worktree-manager.
 */
async function walkWorktreeFiles(
  dir: string,
  root: string,
): Promise<Array<{ path: string; size: number; mtime: string }>> {
  const results: Array<{ path: string; size: number; mtime: string }> = [];

  let items: string[];
  try {
    items = await fs.readdir(dir);
  } catch {
    return results;
  }

  for (const name of items) {
    if (name === "node_modules" || name === ".git" || name === ".selene-manifest.json") {
      continue;
    }
    const fullPath = join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const subEntries = await walkWorktreeFiles(fullPath, root);
        results.push(...subEntries);
      } else if (stat.isFile()) {
        results.push({
          path: relative(root, fullPath).replace(/\\/g, "/"),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    } catch {
      // Skip inaccessible
    }
  }

  return results;
}

/**
 * Check if source file has been modified since the worktree was created.
 * Compares the source file's mtime against the manifest or worktree creation time.
 */
async function hasSourceConflict(
  sourceFile: string,
  worktreeCreatedAt: Date,
): Promise<boolean> {
  try {
    const stat = await fs.stat(sourceFile);
    return stat.mtime > worktreeCreatedAt;
  } catch {
    // File doesn't exist in source — no conflict
    return false;
  }
}

/**
 * Merge strategy: copy changed files from worktree to source root.
 * Detects deleted files, untracked files, source conflicts, and tracks failures.
 */
async function syncMerge(
  worktreePath: string,
  baseBranch: string,
  sourceRoot: string,
  isGitBased: boolean,
  diff: string,
  worktreeCreatedAt?: Date,
): Promise<SyncBackResult> {
  let changedResult: ChangedFilesResult;

  if (isGitBased) {
    changedResult = await getChangedFiles(worktreePath);
  } else {
    changedResult = await getManifestChanges(worktreePath);
  }

  const { changed, deleted } = changedResult;

  if (changed.length === 0 && deleted.length === 0) {
    return { success: true, diff, appliedFiles: [] };
  }

  const appliedFiles: string[] = [];
  const failedFiles: string[] = [];
  const conflictFiles: string[] = [];
  const createdAt = worktreeCreatedAt ?? new Date(0); // fallback: no conflict detection

  // Handle modified/added files
  for (const file of changed) {
    const src = join(worktreePath, file);
    const dest = join(sourceRoot, file);
    try {
      if (!existsSync(src)) {
        continue;
      }

      // Source-freshness check: skip if source was modified after worktree creation
      if (await hasSourceConflict(dest, createdAt)) {
        conflictFiles.push(file);
        continue;
      }

      const destDir = join(dest, "..");
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(src, dest);
      appliedFiles.push(file);
    } catch (err) {
      failedFiles.push(file);
    }
  }

  // Handle deleted files — remove them from source
  for (const file of deleted) {
    const dest = join(sourceRoot, file);
    try {
      if (existsSync(dest)) {
        await fs.unlink(dest);
        appliedFiles.push(file);
      }
    } catch {
      failedFiles.push(file);
    }
  }

  const success = failedFiles.length === 0 && conflictFiles.length === 0;
  return {
    success,
    diff,
    appliedFiles,
    failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
    conflictFiles: conflictFiles.length > 0 ? conflictFiles : undefined,
    error: !success
      ? `${failedFiles.length} file(s) failed, ${conflictFiles.length} file(s) had source conflicts`
      : undefined,
  };
}

/**
 * PR strategy: push worktree branch and create a PR via `gh`.
 */
async function syncPr(
  worktreePath: string,
  branch: string,
  baseBranch: string,
  diff: string,
): Promise<SyncBackResult> {
  const { changed, deleted } = await getChangedFiles(worktreePath);
  const changedFiles = [...changed, ...deleted];

  // Stage and commit any uncommitted changes
  try {
    await runGitCommand(worktreePath, ["add", "-A"], undefined, "[design-cast]");
    await runGitCommand(
      worktreePath,
      ["commit", "-m", "design: apply workspace edits"],
      undefined,
      "[design-cast]",
    );
  } catch {
    // Commit may fail if nothing to commit — that's fine
  }

  // Push the branch
  try {
    await runGitCommand(
      worktreePath,
      ["push", "-u", "origin", branch],
      undefined,
      "[design-cast]",
    );
  } catch (err) {
    return {
      success: false,
      diff,
      appliedFiles: changedFiles,
      error: `Failed to push branch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Try creating a PR via gh CLI
  let prUrl: string | undefined;
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const result = await execFileAsync("gh", [
      "pr", "create",
      "--base", baseBranch,
      "--head", branch,
      "--title", `Design workspace edits (${branch})`,
      "--body", "Automated PR from Selene design workspace.",
    ], { cwd: worktreePath });
    prUrl = result.stdout.trim();
  } catch {
    // gh CLI not available or PR creation failed — still successful push
  }

  return { success: true, diff, appliedFiles: changedFiles, prUrl };
}

/**
 * Cherry-pick strategy: copy only selected files from worktree to source.
 * Handles deletions, source conflicts, and tracks failures.
 */
async function syncCherryPick(
  worktreePath: string,
  sourceRoot: string,
  diff: string,
  files?: string[],
  worktreeCreatedAt?: Date,
): Promise<SyncBackResult> {
  const { changed, deleted } = await getChangedFiles(worktreePath);
  const allFiles = [...changed, ...deleted];
  const targetFiles = files
    ? allFiles.filter((f) => files.includes(f))
    : allFiles;

  if (targetFiles.length === 0) {
    return { success: true, diff, appliedFiles: [] };
  }

  const appliedFiles: string[] = [];
  const failedFiles: string[] = [];
  const conflictFiles: string[] = [];
  const deletedSet = new Set(deleted);
  const createdAt = worktreeCreatedAt ?? new Date(0);

  for (const file of targetFiles) {
    const dest = join(sourceRoot, file);

    // Handle deleted files
    if (deletedSet.has(file)) {
      try {
        if (existsSync(dest)) {
          await fs.unlink(dest);
          appliedFiles.push(file);
        }
      } catch {
        failedFiles.push(file);
      }
      continue;
    }

    const src = join(worktreePath, file);
    try {
      if (!existsSync(src)) {
        continue;
      }

      // Source-freshness check
      if (await hasSourceConflict(dest, createdAt)) {
        conflictFiles.push(file);
        continue;
      }

      const destDir = join(dest, "..");
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(src, dest);
      appliedFiles.push(file);
    } catch {
      failedFiles.push(file);
    }
  }

  const success = failedFiles.length === 0 && conflictFiles.length === 0;
  return {
    success,
    diff,
    appliedFiles,
    failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
    conflictFiles: conflictFiles.length > 0 ? conflictFiles : undefined,
    error: !success
      ? `${failedFiles.length} file(s) failed, ${conflictFiles.length} file(s) had source conflicts`
      : undefined,
  };
}
