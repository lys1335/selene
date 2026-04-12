/**
 * Static HTML/CSS/JS Framework Renderer
 *
 * Simple renderer for plain HTML/CSS/JS projects that do not require
 * compilation. Reads files from disk and injects the inspector script
 * injection point for the preview frame.
 */

import type { FrameworkRenderer, RendererContext, RendererOutput, RendererTier } from "./types";
import type { FrameworkType } from "../project-detection";
import type { DesignWorkspaceCompileReport } from "../config";
import fs from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname, basename } from "path";
import { escapeHtml } from "../preview";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INSPECTOR_COMMENT = "<!-- __SELENE_INSPECTOR_INJECTION_POINT__ -->";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyReport(durationMs: number): DesignWorkspaceCompileReport {
  return {
    warnings: [],
    errors: [],
    dependencyCheck: {
      manifestPackages: [],
      importedPackages: [],
      checkedPackages: [],
      missingManifestPackages: [],
      missingImportedPackages: [],
      missingPackages: [],
    },
    recovered: false,
    durationMs,
  };
}

/**
 * Inject the inspector comment before </head> if present, otherwise before </body>.
 */
function injectInspectorPoint(html: string): string {
  // Try to inject before </head>
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${INSPECTOR_COMMENT}\n</head>`);
  }
  // Fallback: inject before </body>
  if (html.includes("</body>")) {
    return html.replace("</body>", `  ${INSPECTOR_COMMENT}\n</body>`);
  }
  // Last resort: append to end
  return html + "\n" + INSPECTOR_COMMENT;
}

/**
 * Wrap CSS content in a minimal HTML document for preview.
 */
function wrapCssInHtml(css: string, fileName: string): string {
  const safeTitle = escapeHtml(fileName);
  const safeCss = css.replace(/<\/(style)/gi, "<\\/$1");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    "  <style>",
    safeCss,
    "  </style>",
    `  ${INSPECTOR_COMMENT}`,
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root">',
    '    <div style="padding:24px;font-family:ui-sans-serif,system-ui,sans-serif;">',
    `      <h2 style="margin:0 0 16px 0;font-size:18px;">CSS Preview: ${safeTitle}</h2>`,
    '      <p style="margin:0 0 12px 0;">This is a preview of the stylesheet. Elements below demonstrate common tags:</p>',
    '      <h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>',
    '      <p>Paragraph text with <strong>bold</strong>, <em>italic</em>, and <a href="#">link</a> elements.</p>',
    '      <ul><li>List item 1</li><li>List item 2</li><li>List item 3</li></ul>',
    '      <button>Button</button>',
    '      <input type="text" placeholder="Text input" />',
    "    </div>",
    "  </div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Wrap plain JS in a minimal HTML document for preview.
 */
function wrapJsInHtml(js: string, fileName: string): string {
  const safeTitle = escapeHtml(fileName);
  const safeJs = js.replace(/<\/(script)/gi, "<\\/$1");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    `  ${INSPECTOR_COMMENT}`,
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root"></div>',
    `  <script>${safeJs}<\/script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// StaticRenderer
// ---------------------------------------------------------------------------

export class StaticRenderer implements FrameworkRenderer {
  readonly frameworks: FrameworkType[] = ["static"];
  readonly tier: RendererTier = "compile";

  private ctx: RendererContext | null = null;
  private initialized = false;

  // ---- Lifecycle -----------------------------------------------------------

  async startup(ctx: RendererContext): Promise<void> {
    if (!existsSync(ctx.worktreePath)) {
      throw new Error(`Worktree path does not exist: ${ctx.worktreePath}`);
    }
    this.ctx = ctx;
    this.initialized = true;
  }

  isHealthy(): boolean {
    if (!this.initialized || !this.ctx) return false;
    return existsSync(this.ctx.worktreePath);
  }

  async shutdown(): Promise<void> {
    this.ctx = null;
    this.initialized = false;
  }

  // ---- Rendering -----------------------------------------------------------

  async render(targetFile: string, mode: "page" | "component" | "route"): Promise<RendererOutput> {
    this.assertReady();
    const ctx = this.ctx!;
    const startedAt = Date.now();
    const absTarget = resolve(ctx.worktreePath, targetFile);

    if (!existsSync(absTarget)) {
      throw new Error(`Target file not found: ${absTarget}`);
    }

    const sourceCode = await fs.readFile(absTarget, "utf-8");
    const html = this.buildHtml(sourceCode, targetFile);

    return {
      html,
      compileReport: emptyReport(Date.now() - startedAt),
      sourceCode,
    };
  }

  async rerender(targetFile: string, changedCode: string): Promise<RendererOutput> {
    this.assertReady();
    const startedAt = Date.now();
    const html = this.buildHtml(changedCode, targetFile);

    return {
      html,
      compileReport: emptyReport(Date.now() - startedAt),
      sourceCode: changedCode,
    };
  }

  // ---- Internal ------------------------------------------------------------

  private assertReady(): void {
    if (!this.initialized || !this.ctx) {
      throw new Error("StaticRenderer has not been started. Call startup() first.");
    }
  }

  private buildHtml(sourceCode: string, targetFile: string): string {
    const ext = extname(targetFile).toLowerCase();
    const fileName = basename(targetFile);

    switch (ext) {
      case ".html":
      case ".htm":
        return injectInspectorPoint(sourceCode);

      case ".css":
        return wrapCssInHtml(sourceCode, fileName);

      case ".js":
      case ".mjs":
        return wrapJsInHtml(sourceCode, fileName);

      default:
        // For unknown extensions, wrap as plain text in a <pre> block
        return [
          "<!DOCTYPE html>",
          '<html lang="en">',
          "<head>",
          '  <meta charset="utf-8" />',
          `  <title>${escapeHtml(fileName)}</title>`,
          `  ${INSPECTOR_COMMENT}`,
          "</head>",
          "<body>",
          `  <pre style="padding:16px;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(sourceCode)}</pre>`,
          "</body>",
          "</html>",
          "",
        ].join("\n");
    }
  }
}
