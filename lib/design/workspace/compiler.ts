import "server-only";

/**
 * Server-side React/TSX component compiler.
 *
 * Uses esbuild to bundle a preview entry plus the user component into a single
 * self-executing browser script. The component module is compiled as-is and
 * imported through an esbuild virtual module, so the preview pipeline does not
 * rewrite or regex-transform the model output.
 */

import * as esbuild from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { resolve } from "path";
import { SANDBOX_NODE_MODULES } from "../libraries";
import { getProjectRoot } from "../../utils/project-root";
// Turbopack needs a static import it can trace in server bundles.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- CJS config is loaded as the module default at runtime
import previewTailwindConfig from "../../../tailwind.preview.config.cjs";

const VIRTUAL_COMPONENT_PATH = "__selene_preview_component__";
const VIRTUAL_COMPONENT_NAMESPACE = "selene-preview-component";
const PREVIEW_THEME_CSS = [
  ":root {",
  "  --terminal-cream: 34 63% 89%;",
  "  --terminal-cream-dark: 37 52% 81%;",
  "  --terminal-dark: 0 0% 10%;",
  "  --terminal-bg: 0 0% 4%;",
  "  --terminal-green: 18 49% 54%;",
  "  --terminal-amber: 41 100% 50%;",
  "  --terminal-text: 0 0% 88%;",
  "  --terminal-muted: 0 0% 53%;",
  "  --terminal-border: 0 0% 20%;",
  "  --background: 32 55% 89%;",
  "  --foreground: 0 0% 10%;",
  "  --card: 32 55% 89%;",
  "  --card-foreground: 0 0% 10%;",
  "  --popover: 32 55% 89%;",
  "  --popover-foreground: 0 0% 10%;",
  "  --primary: 0 0% 10%;",
  "  --primary-foreground: 32 55% 89%;",
  "  --secondary: 32 40% 85%;",
  "  --secondary-foreground: 0 0% 10%;",
  "  --muted: 32 30% 82%;",
  "  --muted-foreground: 0 0% 53%;",
  "  --accent: 18 49% 54%;",
  "  --accent-foreground: 0 0% 100%;",
  "  --destructive: 0 84% 60%;",
  "  --destructive-foreground: 32 55% 89%;",
  "  --border: 0 0% 75%;",
  "  --input: 0 0% 75%;",
  "  --ring: 18 49% 54%;",
  "  --radius: 0.5rem;",
  "  --chart-1: 18 49% 54%;",
  "  --chart-2: 41 100% 50%;",
  "  --chart-3: 0 0% 53%;",
  "  --chart-4: 32 55% 70%;",
  "  --chart-5: 0 0% 30%;",
  "}",
  ".dark {",
  "  --terminal-cream: 0 0% 14%;",
  "  --terminal-cream-dark: 0 0% 18%;",
  "  --terminal-dark: 34 63% 90%;",
  "  --terminal-bg: 0 0% 8%;",
  "  --terminal-green: 18 49% 54%;",
  "  --terminal-amber: 41 100% 50%;",
  "  --terminal-text: 0 0% 92%;",
  "  --terminal-muted: 0 0% 70%;",
  "  --terminal-border: 0 0% 28%;",
  "  --background: 0 0% 14%;",
  "  --foreground: 34 63% 90%;",
  "  --card: 0 0% 17%;",
  "  --card-foreground: 34 63% 90%;",
  "  --popover: 0 0% 16%;",
  "  --popover-foreground: 34 63% 90%;",
  "  --primary: 34 63% 90%;",
  "  --primary-foreground: 0 0% 10%;",
  "  --secondary: 0 0% 20%;",
  "  --secondary-foreground: 34 63% 90%;",
  "  --muted: 0 0% 20%;",
  "  --muted-foreground: 0 0% 65%;",
  "  --accent: 18 49% 54%;",
  "  --accent-foreground: 0 0% 100%;",
  "  --destructive: 0 62.8% 30.6%;",
  "  --destructive-foreground: 34 63% 90%;",
  "  --border: 0 0% 24%;",
  "  --input: 0 0% 24%;",
  "  --ring: 18 49% 54%;",
  "  --chart-1: 18 49% 54%;",
  "  --chart-2: 41 100% 50%;",
  "  --chart-3: 0 0% 65%;",
  "  --chart-4: 34 63% 70%;",
  "  --chart-5: 0 0% 50%;",
  "}",
].join("\n");

const PROJECT_ROOT = getProjectRoot();
const TAILWIND_INPUT_PATH = resolve(PROJECT_ROOT, "lib/design/workspace/preview.tailwind.css");
const PREVIEW_TAILWIND_SOURCE = [
  "@tailwind base;",
  "@tailwind components;",
  "@tailwind utilities;",
  "",
  "@layer base {",
  "  html, body, #selene-design-preview-root {",
  "    margin: 0;",
  "    width: 100%;",
  "    height: 100%;",
  "    background: transparent;",
  "  }",
  "}",
  "",
].join("\n");

function createPreviewEntrySource(): string {
  return [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    `import Component from '${VIRTUAL_COMPONENT_PATH}';`,
    "",
    "class __SeleneErrorBoundary__ extends React.Component {",
    "  constructor(props) {",
    "    super(props);",
    "    this.state = { error: null };",
    "  }",
    "",
    "  static getDerivedStateFromError(error) {",
    "    return { error };",
    "  }",
    "",
    "  render() {",
    "    if (this.state.error) {",
    "      var msg = 'Render Error:\\n' + (this.state.error.stack || this.state.error.message);",
    "      return React.createElement('pre', { style: { padding: '16px', fontFamily: 'ui-monospace, monospace', background: '#111827', color: '#ef4444', whiteSpace: 'pre-wrap', fontSize: '13px', margin: 0 } }, msg);",
    "    }",
    "    return this.props.children;",
    "  }",
    "}",
    "",
    "var __root__ = document.getElementById('selene-design-preview-root');",
    "if (!__root__) {",
    "  throw new Error('Preview root not found');",
    "}",
    "",
    "if (typeof Component !== 'function') {",
    "  throw new Error('Default export must be a React component function.');",
    "}",
    "",
    "try {",
    "  createRoot(__root__).render(",
    "    React.createElement(__SeleneErrorBoundary__, null, React.createElement(Component))",
    "  );",
    "  requestAnimationFrame(function() {",
    "    __root__.setAttribute('data-preview-ready', 'true');",
    "  });",
    "} catch (e) {",
    "  var div = document.createElement('div');",
    "  div.style.cssText = 'padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#ef4444;white-space:pre-wrap;font-size:13px;';",
    "  div.textContent = 'Mount Error:\\n' + (e.stack || e.message);",
    "  __root__.replaceChildren(div);",
    "}",
  ].join("\n");
}

function createComponentPlugin(componentCode: string): esbuild.Plugin {
  return {
    name: "selene-preview-component",
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${VIRTUAL_COMPONENT_PATH}$`) }, () => ({
        path: VIRTUAL_COMPONENT_PATH,
        namespace: VIRTUAL_COMPONENT_NAMESPACE,
      }));

      build.onLoad({ filter: /.*/, namespace: VIRTUAL_COMPONENT_NAMESPACE }, () => ({
        contents: componentCode,
        loader: "tsx",
        resolveDir: PROJECT_ROOT,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

interface CompileResult {
  code: string;
  warnings: string[];
  diagnostics?: Array<{ text: string; location?: { file: string; line: number; column: number } }>;
}

/**
 * Compile a React/TSX component into a self-contained JavaScript bundle.
 *
 * The preview entry imports the component via a virtual module so the model
 * output stays untouched and standard ES module semantics handle the default
 * export contract.
 */
async function compileReactComponent(componentCode: string): Promise<CompileResult> {
  const result = await esbuild.build({
    stdin: {
      contents: createPreviewEntrySource(),
      resolveDir: PROJECT_ROOT,
      loader: "tsx",
    },
    absWorkingDir: PROJECT_ROOT,
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
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    alias: {
      // Pin React to the main project copy so sandbox packages (e.g.
      // @react-three/fiber) share the same React instance as the preview
      // entry.  Two React instances cause "Cannot read properties of null
      // (reading 'useMemo')" because hooks rely on a shared internals
      // singleton.
      "react": resolve(PROJECT_ROOT, "node_modules/react"),
      "react-dom": resolve(PROJECT_ROOT, "node_modules/react-dom"),
      "react/jsx-runtime": resolve(PROJECT_ROOT, "node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": resolve(PROJECT_ROOT, "node_modules/react/jsx-dev-runtime"),
    },
    nodePaths: [SANDBOX_NODE_MODULES],
    plugins: [createComponentPlugin(componentCode)],
  });

  const warnings = result.warnings.map((warning) => warning.text);
  const diagnostics = result.warnings.map((warning) => ({
    text: warning.text,
    location: warning.location
      ? {
          file: warning.location.file,
          line: warning.location.line,
          column: warning.location.column,
        }
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape `</script>` sequences in compiled JS to prevent breaking
 * the inline `<script>` tag in the preview HTML document.
 */
function escapeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

async function buildPreviewTailwindCss(componentCode: string): Promise<string> {
  const baseConfig = previewTailwindConfig as unknown as Omit<Config, "content">;
  const config = {
    ...baseConfig,
    content: [
      {
        raw: componentCode,
        extension: "tsx",
      },
    ],
  } satisfies Config;

  const result = await postcss([tailwindcss(config)]).process(PREVIEW_TAILWIND_SOURCE, {
    from: TAILWIND_INPUT_PATH,
  });

  return result.css;
}

/**
 * Escape `</style>` sequences to prevent breaking inline `<style>` tags.
 * CSS is raw text inside `<style>` — HTML entities are NOT decoded,
 * so we must NOT use HTML escaping here.
 */
function escapeInlineStyle(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

function buildCompiledPreviewHtml(compiledJs: string, tailwindCss: string, title: string): string {
  const safeJs = escapeInlineScript(compiledJs);
  const safeCss = escapeInlineStyle(tailwindCss);
  const safeThemeCss = escapeInlineStyle(PREVIEW_THEME_CSS);

  return [
    "<!DOCTYPE html>",
    '<html lang="en" class="dark">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    safeThemeCss,
    "  </style>",
    "  <style>",
    safeCss,
    "  </style>",
    "  <style>",
    "    html, body, #selene-design-preview-root { margin: 0; height: 100%; width: 100%; overflow: auto; background: transparent; }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root"></div>',
    "  <script>",
    "    function __showError__(label, msg) {",
    "      var root = document.getElementById('selene-design-preview-root');",
    "      if (!root) return;",
    "      var div = document.createElement('div');",
    "      div.style.cssText = 'padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#ef4444;white-space:pre-wrap;font-size:13px;';",
    "      div.textContent = label + ':\\n' + msg;",
    "      root.replaceChildren(div);",
    "    }",
    "    window.onerror = function(msg, src, line, col, err) {",
    "      __showError__('Runtime Error', err ? (err.stack || err.message) : String(msg));",
    "      return true;",
    "    };",
    "    window.onunhandledrejection = function(event) {",
    "      var reason = event.reason;",
    "      __showError__('Unhandled Promise Rejection', reason ? (reason.stack || reason.message || String(reason)) : 'Unknown');",
    "    };",
    "  </script>",
    `  <script>${safeJs}<\/script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * High-level helper: compile a TSX component and return the full preview HTML.
 */
export async function buildTailwindPreviewAsync(componentCode: string, title: string): Promise<string> {
  const { code: compiledJs } = await compileReactComponent(componentCode);
  const tailwindCss = await buildPreviewTailwindCss(componentCode);
  return buildCompiledPreviewHtml(compiledJs, tailwindCss, title);
}
