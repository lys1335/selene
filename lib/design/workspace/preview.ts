/**
 * Design Preview — HTML document builders.
 *
 * Two rendering paths:
 *
 * 1. **HTML mode** — LLM-generated HTML is inserted directly into an iframe
 *    srcdoc. The iframe sandbox + CSP provide the security boundary.
 *
 * 2. **Tailwind/React mode** — Components are compiled server-side by esbuild
 *    (see compiler.ts). This module provides a loading placeholder for sync
 *    contexts; the actual preview HTML is built by `buildTailwindPreviewAsync`
 *    in compiler.ts and set asynchronously.
 *
 * The old CDN pipeline (Babel Standalone + esm.sh dynamic imports) has been
 * replaced by server-side esbuild compilation. All React, Lucide, and Framer
 * Motion dependencies are bundled at compile time — no CDN fetches needed for
 * component rendering.
 */

import { htmlToJsx, validateJsx } from "@/lib/design/utils/jsx";

export type DesignExportMode = "html" | "tailwind";

export interface BuildDesignPreviewOptions {
  code: string;
  mode?: DesignExportMode;
  componentName?: string;
  animated?: boolean;
  exportProgress?: number;
}

const DEFAULT_COMPONENT_NAME = "Design Component";

/** CSP for HTML previews — allows inline scripts for interactive components. */
const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "img-src https: http: data: blob:",
  "media-src https: http: data: blob:",
  "font-src https: http: data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
].join("; ");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join("\n");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inferDesignMode(code: string, mode?: DesignExportMode): DesignExportMode {
  if (mode) {
    return mode;
  }

  if (
    code.includes("export default function") ||
    code.includes("className=") ||
    code.includes("React.") ||
    code.includes("framer-motion")
  ) {
    return "tailwind";
  }

  return "html";
}

// ---------------------------------------------------------------------------
// React export (HTML → JSX conversion for export feature)
// ---------------------------------------------------------------------------

export function htmlToReactExport(html: string): string {
  const jsx = htmlToJsx(html);
  const validation = validateJsx(jsx);
  const trimmed = jsx.trim();
  const multipleRoots = /^<[^>]+>[\s\S]*<[^/!][^>]*>/.test(trimmed) && !trimmed.startsWith("<>");
  const body = validation.valid && !multipleRoots ? jsx : `<>\n${indent(jsx, 2)}\n</>`;

  return [
    "/* Auto-converted from HTML - review for correctness */",
    "export default function GeneratedComponent() {",
    "  return (",
    indent(body, 4),
    "  );",
    "}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// HTML mode preview builder
// ---------------------------------------------------------------------------

function clampProgress(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function buildAnimatedRootStyles(animated?: boolean): string[] {
  if (!animated) return [];
  // Export animation only — no layout constraints (LLM controls layout)
  return [
    "    #selene-design-preview-root {",
    "      will-change: transform, filter;",
    "      transform: translate3d(0, calc((0.5 - var(--export-progress)) * 12px), 0) scale(calc(1 + var(--export-progress) * 0.035));",
    "      filter: saturate(calc(0.96 + var(--export-progress) * 0.08));",
    "      transform-origin: center center;",
    "    }",
  ];
}

function buildHead(title: string, csp: string, animated?: boolean, exportProgress?: number): string[] {
  return [
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />`,
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    `    :root { --export-progress: ${clampProgress(exportProgress).toFixed(4)}; }`,
    "    html, body { margin: 0; height: 100%; width: 100%; overflow: auto; }",
    ...buildAnimatedRootStyles(animated),
    "  </style>",
  ];
}

function buildHtmlPreviewHtml(code: string, title: string, animated?: boolean, exportProgress?: number): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    ...buildHead(title, HTML_PREVIEW_CSP, animated, exportProgress),
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root" data-preview-ready="true">',
    code,
    "  </div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tailwind mode placeholder
// ---------------------------------------------------------------------------

/**
 * Lightweight loading placeholder for Tailwind components.
 *
 * Shown briefly while the server-side esbuild compilation runs. The real
 * preview HTML is produced by `buildTailwindPreviewAsync()` in compiler.ts
 * and replaces this placeholder asynchronously.
 */
function buildTailwindPlaceholder(title: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    "    html, body { margin: 0; height: 100%; width: 100%; background: #111827; }",
    "    .loader { display: flex; align-items: center; justify-content: center; height: 100%; gap: 8px; }",
    "    .loader span { color: #9ca3af; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }",
    "    .dot { width: 6px; height: 6px; background: #6366f1; border-radius: 50%; animation: pulse 1.2s infinite; }",
    "    .dot:nth-child(2) { animation-delay: 0.2s; }",
    "    .dot:nth-child(3) { animation-delay: 0.4s; }",
    "    @keyframes pulse { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="loader">',
    '    <div class="dot"></div>',
    '    <div class="dot"></div>',
    '    <div class="dot"></div>',
    "    <span>Compiling component…</span>",
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build a preview HTML document for a design component.
 *
 * **HTML mode**: Returns a complete srcdoc document with the code inline.
 * **Tailwind mode**: Returns a loading placeholder. The actual compiled
 * preview is built asynchronously by the server-side compiler and set via
 * the store's `setPreviewHtml()`.
 */
export function buildDesignPreviewHtml(options: BuildDesignPreviewOptions): string {
  const code = options.code.trim();
  if (!code) {
    throw new Error("Component code is required to build a preview.");
  }

  const title = (options.componentName || DEFAULT_COMPONENT_NAME).trim() || DEFAULT_COMPONENT_NAME;
  const mode = inferDesignMode(code, options.mode);

  if (mode === "tailwind") {
    return buildTailwindPlaceholder(title);
  }

  return buildHtmlPreviewHtml(code, title, options.animated, options.exportProgress);
}
