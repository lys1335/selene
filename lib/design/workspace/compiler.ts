/**
 * Server-side React/TSX component compiler.
 *
 * Uses esbuild (already a project dependency) to compile TSX components and
 * bundle all their imports (React, Lucide, Framer Motion, etc.) into a single
 * self-executing script. This replaces the fragile CDN-based pipeline
 * (Babel Standalone + esm.sh dynamic imports) with a reliable, offline-capable
 * compilation step.
 *
 * The compiled output is an IIFE that:
 * 1. Contains React, ReactDOM, and all imported packages inline
 * 2. Finds the component's default export
 * 3. Renders it into #selene-design-preview-root
 *
 * Tailwind CSS is NOT bundled here — it's loaded via CDN in the preview HTML
 * since it needs to scan the rendered DOM at runtime.
 */

import * as esbuild from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Project root resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the project root directory for esbuild import resolution.
 * Uses the module's own location to navigate to the project root, avoiding
 * dependence on process.cwd() which can differ in Electron or worker contexts.
 */
function getProjectRoot(): string {
  try {
    // ESM: use import.meta.url
    if (typeof import.meta?.url === "string") {
      // This file is at lib/design/workspace/compiler.ts → root is 3 levels up
      return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    }
  } catch {
    // Fallback
  }

  // Fallback: process.cwd() (correct for Next.js server)
  return process.cwd();
}

const PROJECT_ROOT = getProjectRoot();

// ---------------------------------------------------------------------------
// Entry code builder
// ---------------------------------------------------------------------------

/**
 * Transform component source code into a compilable entry point that:
 * - Ensures React is imported (for React.useState etc.)
 * - Strips `export default` and captures the component name
 * - Adds ReactDOM rendering code
 *
 * Handles all common default export patterns:
 * - `export default function Name() {}`
 * - `export default function() {}`
 * - `export default Name;`
 * - `export default () => ...`
 * - `export default memo(Name)`
 * - `export default class Name {}`
 */
function buildPreviewEntry(componentCode: string): string {
  const lines: string[] = [];

  // Ensure React is in scope (many components use React.useState without importing).
  // Check for any form of React import: default, named, or namespace.
  const hasReactImport =
    /import\s+React\b/.test(componentCode) ||
    /import\s+\*\s+as\s+React\b/.test(componentCode) ||
    /import\s+\{[^}]*\}\s+from\s+['"]react['"]/.test(componentCode);

  if (!hasReactImport) {
    lines.push("import React from 'react';");
  } else if (!/import\s+React\b/.test(componentCode) && /React\./.test(componentCode)) {
    // Has named imports from react (e.g., `import { useState }`) but also uses
    // `React.useState` — add a default import to cover both.
    lines.push("import React from 'react';");
  }

  // Always add ReactDOM for rendering
  lines.push("import { createRoot } from 'react-dom/client';");
  lines.push("");

  // Process component code: strip export default, capture component name
  let processedCode = componentCode;
  let componentName = "__SeleneComponent__";

  // Case 1: export default function ComponentName(...) { ... }
  const namedDefaultMatch = componentCode.match(
    /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/
  );
  if (namedDefaultMatch) {
    componentName = namedDefaultMatch[1];
    processedCode = componentCode.replace(
      /export\s+default\s+function/,
      "function"
    );
  }
  // Case 2: export default function(...) { ... } (anonymous)
  else if (/export\s+default\s+function\s*[(<]/.test(componentCode)) {
    processedCode = componentCode.replace(
      /export\s+default\s+function/,
      `function ${componentName}`
    );
  }
  // Case 3: export default IdentifierName; (trailing named reference)
  else if (/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.test(componentCode)) {
    const identMatch = componentCode.match(
      /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m
    );
    if (identMatch) {
      componentName = identMatch[1];
      processedCode = componentCode.replace(
        /export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/m,
        ""
      );
    }
  }
  // Case 4: Catch-all — any expression (arrow function, memo(), class, HOC, etc.)
  // Converts `export default <expr>` → `const __SeleneComponent__ = <expr>`
  else if (/export\s+default\s+/.test(componentCode)) {
    processedCode = componentCode.replace(
      /export\s+default\s+/,
      `const ${componentName} = `
    );
  }

  lines.push(processedCode);
  lines.push("");
  lines.push("// Mount the component");
  lines.push(
    `createRoot(document.getElementById('selene-design-preview-root')).render(React.createElement(${componentName}));`
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface CompileResult {
  /** The compiled JavaScript bundle (IIFE format). */
  code: string;
  /** Any warnings from esbuild. */
  warnings: string[];
  /** Structured error details from esbuild (if any non-fatal). */
  diagnostics?: Array<{ text: string; location?: { file: string; line: number; column: number } }>;
}

/**
 * Compile a React/TSX component into a self-contained JavaScript bundle.
 *
 * Resolves all imports (react, lucide-react, framer-motion, etc.) from the
 * host project's node_modules and bundles them into a single IIFE script.
 *
 * @param componentCode - Raw TSX source code with `export default function`
 * @returns Compiled JS bundle ready for inline `<script>` injection
 */
export async function compileReactComponent(
  componentCode: string
): Promise<CompileResult> {
  const entry = buildPreviewEntry(componentCode);

  const result = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: PROJECT_ROOT,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    write: false,
    minify: false,
    target: ["es2020"],
    jsx: "automatic",
    jsxImportSource: "react",
    logLevel: "silent",
    treeShaking: true,
    sourcemap: false,
  });

  const warnings = result.warnings.map((w) => w.text);
  const diagnostics = result.warnings.map((w) => ({
    text: w.text,
    location: w.location
      ? { file: w.location.file, line: w.location.line, column: w.location.column }
      : undefined,
  }));

  if (result.outputFiles.length === 0) {
    throw new Error("esbuild produced no output files");
  }

  return {
    code: result.outputFiles[0].text,
    warnings,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

// ---------------------------------------------------------------------------
// Preview HTML builder
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape `</script>` sequences in compiled JS to prevent breaking
 * the inline `<script>` tag in the preview HTML document.
 */
function escapeInlineScript(js: string): string {
  return js.replace(/<\/script>/gi, "<\\/script>");
}

/**
 * Build a complete HTML document for a compiled React component preview.
 *
 * The document includes:
 * - Tailwind CSS CDN (for runtime class → CSS generation)
 * - The compiled JS bundle (React + component + all deps)
 * - A #selene-design-preview-root element for React to mount into
 *
 * Uses the same root element ID as the HTML mode preview so that the
 * `waitForPageReady()` function in export.ts works for both modes.
 */
export function buildCompiledPreviewHtml(
  compiledJs: string,
  title: string
): string {
  const safeJs = escapeInlineScript(compiledJs);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <script src="https://cdn.tailwindcss.com"><\/script>',
    "  <style>",
    "    html, body, #selene-design-preview-root { margin: 0; height: 100%; width: 100%; }",
    "    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root" data-preview-ready="true"></div>',
    `  <script>${safeJs}<\/script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * High-level helper: compile a TSX component and return the full preview HTML.
 *
 * This is the primary entry point for server-side Tailwind preview rendering.
 */
export async function buildTailwindPreviewAsync(
  componentCode: string,
  title: string
): Promise<string> {
  const { code: compiledJs } = await compileReactComponent(componentCode);
  return buildCompiledPreviewHtml(compiledJs, title);
}
