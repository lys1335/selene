/**
 * React / Next.js Framework Renderer
 *
 * Compiles JSX/TSX using the project's own dependencies via esbuild.
 * Resolves modules from the worktree's node_modules and uses the project's
 * tsconfig.json for path aliases and tailwind.config for styling.
 */

import type { FrameworkRenderer, RendererContext, RendererOutput, RendererTier } from "./types";
import type { FrameworkType } from "../project-detection";
import type {
  DesignWorkspaceCompilationIssue,
  DesignWorkspaceCompileReport,
  DesignWorkspaceDiagnostic,
  DesignWorkspaceDependencySummary,
} from "../config";
import * as esbuild from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import fs from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname, basename } from "path";
import { escapeHtml } from "../preview";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPILE_TIMEOUT_MS = 15_000;
const TAILWIND_TIMEOUT_MS = 15_000;

const TAILWIND_INPUT_SOURCE = [
  "@tailwind base;",
  "@tailwind components;",
  "@tailwind utilities;",
  "",
].join("\n");

const PREVIEW_RESET_CSS = [
  "html, body, #selene-design-preview-root { margin: 0; width: 100%; height: 100%; }",
].join("\n");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const timer = setTimeout(() => {
      rej(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    promise.then(
      (value) => { clearTimeout(timer); res(value); },
      (error) => { clearTimeout(timer); rej(error); },
    );
  });
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

function escapeInlineStyle(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

function inferIssueType(message: string): DesignWorkspaceCompilationIssue["type"] {
  const norm = message.toLowerCase();
  if (norm.includes("could not resolve") || norm.includes("cannot find module") || norm.includes("failed to resolve")) {
    return "dependency";
  }
  if (norm.includes("expected") || norm.includes("unexpected") || norm.includes("syntax") || norm.includes("unterminated")) {
    return "syntax";
  }
  if (norm.includes("type") || norm.includes("jsx")) {
    return "type";
  }
  if (norm.includes("runtime") || norm.includes("render")) {
    return "runtime";
  }
  return "unknown";
}

function toDiagnosticLocation(location?: esbuild.Location): DesignWorkspaceDiagnostic["location"] {
  if (!location?.file) return undefined;
  return { file: location.file, line: location.line, column: location.column };
}

function emptyDependencySummary(): DesignWorkspaceDependencySummary {
  return {
    manifestPackages: [],
    importedPackages: [],
    checkedPackages: [],
    missingManifestPackages: [],
    missingImportedPackages: [],
    missingPackages: [],
  };
}

function emptyReport(durationMs: number): DesignWorkspaceCompileReport {
  return {
    warnings: [],
    errors: [],
    dependencyCheck: emptyDependencySummary(),
    recovered: false,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Preview entry source builder
// ---------------------------------------------------------------------------

function createPreviewEntrySource(targetFile: string, mode: "page" | "component" | "route"): string {
  // Use the actual file path as the import specifier so esbuild resolves it
  // from the worktree's node_modules / filesystem.
  const importPath = targetFile.replace(/\\/g, "/");

  const lines = [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    `import Component from '${importPath}';`,
    "",
    "class __SeleneErrorBoundary__ extends React.Component {",
    "  constructor(props) { super(props); this.state = { error: null }; }",
    "  static getDerivedStateFromError(error) { return { error }; }",
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
    "if (!__root__) throw new Error('Preview root not found');",
    "",
    "if (typeof Component !== 'function') {",
    "  throw new Error('Default export must be a React component function.');",
    "}",
    "",
    "try {",
    "  createRoot(__root__).render(",
    "    React.createElement(__SeleneErrorBoundary__, null, React.createElement(Component))",
    "  );",
    "  requestAnimationFrame(function() { __root__.setAttribute('data-preview-ready', 'true'); });",
    "} catch (e) {",
    "  var div = document.createElement('div');",
    "  div.style.cssText = 'padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#ef4444;white-space:pre-wrap;font-size:13px;';",
    "  div.textContent = 'Mount Error:\\n' + (e.stack || e.message);",
    "  __root__.replaceChildren(div);",
    "}",
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// esbuild plugins
// ---------------------------------------------------------------------------

/**
 * Plugin that replaces the target file contents with in-memory code
 * (used by rerender to supply changed code without writing to disk).
 */
function createCodeOverridePlugin(targetAbsPath: string, code: string): esbuild.Plugin {
  return {
    name: "selene-code-override",
    setup(build) {
      const normalized = targetAbsPath.replace(/\\/g, "/");
      build.onLoad({ filter: /.*/ }, (args) => {
        if (args.path.replace(/\\/g, "/") === normalized) {
          return { contents: code, loader: "tsx", resolveDir: resolve(targetAbsPath, "..") };
        }
        return undefined;
      });
    },
  };
}

/**
 * Plugin that handles external HTTP/HTTPS imports (e.g. Google Fonts CDN URLs).
 */
function createExternalUrlPlugin(): esbuild.Plugin {
  return {
    name: "selene-external-url",
    setup(build) {
      build.onResolve({ filter: /^https?:\/\// }, (args) => ({
        path: args.path,
        namespace: "selene-external-url",
      }));

      build.onLoad({ filter: /.*/, namespace: "selene-external-url" }, (args) => {
        const url = args.path;
        const isStylesheet =
          url.includes("fonts.googleapis.com") ||
          url.endsWith(".css") ||
          url.includes("stylesheet");

        if (isStylesheet) {
          return {
            contents: [
              "(function() {",
              "  var link = document.createElement('link');",
              "  link.rel = 'stylesheet';",
              `  link.href = ${JSON.stringify(url)};`,
              "  document.head.appendChild(link);",
              "})();",
            ].join("\n"),
            loader: "js" as const,
          };
        }

        return { contents: "", loader: "js" as const };
      });
    },
  };
}

/**
 * Esbuild plugin that replaces Next.js framework modules (next/link, next/image, etc.)
 * with lightweight browser-safe stubs. This prevents bundling Next.js client internals
 * that depend on `process`, router context, and other server-side globals.
 */
function createNextShimPlugin(): esbuild.Plugin {
  return {
    name: "selene-next-shim",
    setup(build) {
      // Intercept bare next/* imports
      build.onResolve({ filter: /^next\/(link|image|router|navigation|head|script|dynamic|font)/ }, (args) => ({
        path: args.path,
        namespace: "selene-next-shim",
      }));

      // Also intercept next/dist/* internal imports that leak through
      build.onResolve({ filter: /^next\/dist\// }, (args) => ({
        path: args.path,
        namespace: "selene-next-shim",
      }));

      build.onLoad({ filter: /.*/, namespace: "selene-next-shim" }, (args) => {
        const shims: Record<string, string> = {
          "next/link": `
            import React from 'react';
            export default function Link({href, children, ...props}) {
              return React.createElement('a', {href: typeof href === 'object' ? href.pathname || '/' : href, ...props}, children);
            }`,
          "next/image": `
            import React from 'react';
            export default function Image({src, alt, width, height, fill, ...props}) {
              const style = fill ? {objectFit: 'cover', width: '100%', height: '100%'} : {};
              return React.createElement('img', {src, alt, width: fill ? undefined : width, height: fill ? undefined : height, style, ...props});
            }`,
          "next/router": `
            const router = { pathname: '/', query: {}, asPath: '/', push: () => Promise.resolve(true), replace: () => Promise.resolve(true), back: () => {}, reload: () => {}, events: { on: () => {}, off: () => {}, emit: () => {} } };
            export function useRouter() { return router; }
            export default { useRouter };`,
          "next/navigation": `
            export function useRouter() { return { push: () => {}, replace: () => {}, back: () => {}, refresh: () => {}, prefetch: () => Promise.resolve() }; }
            export function usePathname() { return '/'; }
            export function useSearchParams() { return new URLSearchParams(); }
            export function useParams() { return {}; }
            export function useSelectedLayoutSegment() { return null; }
            export function useSelectedLayoutSegments() { return []; }
            export function redirect(url) { console.warn('[Selene Preview] redirect() called:', url); }
            export function notFound() { console.warn('[Selene Preview] notFound() called'); }`,
          "next/head": `
            import React from 'react';
            export default function Head({children}) { return null; }`,
          "next/script": `
            import React from 'react';
            export default function Script(props) { return null; }`,
          "next/dynamic": `
            import React from 'react';
            export default function dynamic(loader, options) {
              const LazyComponent = React.lazy(typeof loader === 'function' ? loader : () => loader);
              return function DynamicComponent(props) {
                return React.createElement(React.Suspense, {fallback: options?.loading ? React.createElement(options.loading) : null}, React.createElement(LazyComponent, props));
              };
            }`,
        };

        // For next/font/* - return empty export
        if (args.path.startsWith("next/font")) {
          return { contents: "export default function() { return { className: '', style: {} }; }", loader: "js" };
        }

        // For next/dist/* internal modules - return empty stubs
        if (args.path.startsWith("next/dist/")) {
          return { contents: "export default {}; export const __esModule = true;", loader: "js" };
        }

        const content = shims[args.path];
        if (content) {
          return { contents: content, loader: "tsx" };
        }

        // Fallback for unknown next/* modules
        return { contents: "export default {}; export const __esModule = true;", loader: "js" };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildPreviewHtml(
  compiledJs: string,
  tailwindCss: string,
  title: string,
  themeClass = "dark",
): string {
  const safeJs = escapeInlineScript(compiledJs);
  const safeCss = escapeInlineStyle(tailwindCss);

  return [
    "<!DOCTYPE html>",
    `<html lang="en" class="${themeClass}">`,
    "<head>",
    '  <script>window.process=window.process||{env:{NODE_ENV:"development"}};</script>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <link rel="preconnect" href="https://fonts.googleapis.com" />',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />',
    "  <style>",
    safeCss,
    "  </style>",
    "  <style>",
    PREVIEW_RESET_CSS,
    "  </style>",
    "  <!-- __SELENE_INSPECTOR_INJECTION_POINT__ -->",
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

// ---------------------------------------------------------------------------
// ReactRenderer
// ---------------------------------------------------------------------------

export class ReactRenderer implements FrameworkRenderer {
  readonly frameworks: FrameworkType[] = ["react"];
  readonly tier: RendererTier = "compile";

  private ctx: RendererContext | null = null;
  private worktreeNodeModules: string = "";
  private tailwindConfigPath: string | null = null;
  private tsconfigPath: string | null = null;
  private initialized = false;

  // ---- Lifecycle -----------------------------------------------------------

  async startup(ctx: RendererContext): Promise<void> {
    this.ctx = ctx;
    this.worktreeNodeModules = join(ctx.worktreePath, "node_modules");

    // Validate worktree has node_modules
    if (!existsSync(this.worktreeNodeModules)) {
      throw new Error(
        `Worktree node_modules not found at ${this.worktreeNodeModules}. ` +
        "Run the project's package manager install first.",
      );
    }

    // Detect tailwind config in worktree
    this.tailwindConfigPath = this.findTailwindConfig(ctx.worktreePath);

    // Detect tsconfig.json in worktree
    const tsconfig = join(ctx.worktreePath, "tsconfig.json");
    this.tsconfigPath = existsSync(tsconfig) ? tsconfig : null;

    this.initialized = true;
  }

  isHealthy(): boolean {
    if (!this.initialized || !this.ctx) return false;
    return existsSync(this.ctx.worktreePath);
  }

  async shutdown(): Promise<void> {
    this.ctx = null;
    this.worktreeNodeModules = "";
    this.tailwindConfigPath = null;
    this.tsconfigPath = null;
    this.initialized = false;
  }

  // ---- Rendering -----------------------------------------------------------

  async render(targetFile: string, mode: "page" | "component" | "route"): Promise<RendererOutput> {
    this.assertReady();
    const ctx = this.ctx!;
    const absTarget = resolve(ctx.worktreePath, targetFile);

    if (!existsSync(absTarget)) {
      throw new Error(`Target file not found: ${absTarget}`);
    }

    const sourceCode = await fs.readFile(absTarget, "utf-8");
    return this.compileAndBuild(absTarget, sourceCode, targetFile, mode);
  }

  async rerender(targetFile: string, changedCode: string): Promise<RendererOutput> {
    this.assertReady();
    const ctx = this.ctx!;
    const absTarget = resolve(ctx.worktreePath, targetFile);
    return this.compileAndBuild(absTarget, changedCode, targetFile, "component");
  }

  // ---- Internal ------------------------------------------------------------

  private assertReady(): void {
    if (!this.initialized || !this.ctx) {
      throw new Error("ReactRenderer has not been started. Call startup() first.");
    }
  }

  private findTailwindConfig(root: string): string | null {
    const candidates = [
      "tailwind.config.js",
      "tailwind.config.ts",
      "tailwind.config.cjs",
      "tailwind.config.mjs",
    ];
    for (const c of candidates) {
      const p = join(root, c);
      if (existsSync(p)) return p;
    }
    return null;
  }

  private async compileAndBuild(
    absTarget: string,
    sourceCode: string,
    relativeTarget: string,
    mode: "page" | "component" | "route",
  ): Promise<RendererOutput> {
    const ctx = this.ctx!;
    const startedAt = Date.now();
    const title = basename(relativeTarget, extname(relativeTarget));

    try {
      const compiled = await this.compileWithEsbuild(absTarget, sourceCode, mode);
      const tailwindCss = await this.buildTailwindCss(sourceCode);
      const html = buildPreviewHtml(compiled.code, tailwindCss, title);

      const report: DesignWorkspaceCompileReport = {
        warnings: compiled.warnings,
        diagnostics: compiled.diagnostics,
        errors: [],
        dependencyCheck: emptyDependencySummary(),
        recovered: false,
        durationMs: Date.now() - startedAt,
      };

      return { html, compileReport: report, sourceCode };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Compilation failed.";
      const report: DesignWorkspaceCompileReport = {
        warnings: [],
        errors: [{ type: inferIssueType(errMsg), message: errMsg }],
        dependencyCheck: emptyDependencySummary(),
        recovered: false,
        durationMs: Date.now() - startedAt,
      };

      // Return error HTML instead of throwing so the preview frame shows the error
      const html = buildPreviewHtml(
        `document.getElementById('selene-design-preview-root').innerHTML = '<pre style="padding:16px;font-family:monospace;color:#ef4444;background:#111827;white-space:pre-wrap">' + ${JSON.stringify(escapeHtml(errMsg))} + '</pre>';`,
        "",
        title,
      );

      return { html, compileReport: report, sourceCode };
    }
  }

  private async compileWithEsbuild(
    absTarget: string,
    sourceCode: string,
    mode: "page" | "component" | "route",
  ): Promise<{ code: string; warnings: string[]; diagnostics?: DesignWorkspaceDiagnostic[] }> {
    const ctx = this.ctx!;
    const entrySource = createPreviewEntrySource(absTarget, mode);

    // Build esbuild alias map for React to ensure single copy
    const reactDir = join(this.worktreeNodeModules, "react");
    const reactDomDir = join(this.worktreeNodeModules, "react-dom");
    const alias: Record<string, string> = {};

    if (existsSync(reactDir)) {
      alias["react"] = reactDir;
      const jsxRuntime = join(reactDir, "jsx-runtime");
      if (existsSync(jsxRuntime + ".js") || existsSync(join(reactDir, "jsx-runtime.js"))) {
        alias["react/jsx-runtime"] = jsxRuntime;
      }
      const jsxDevRuntime = join(reactDir, "jsx-dev-runtime");
      if (existsSync(jsxDevRuntime + ".js") || existsSync(join(reactDir, "jsx-dev-runtime.js"))) {
        alias["react/jsx-dev-runtime"] = jsxDevRuntime;
      }
    }
    if (existsSync(reactDomDir)) {
      alias["react-dom"] = reactDomDir;
    }

    // Build tsconfig paths-based aliases if available
    const tsconfigRaw = await this.loadTsconfigPaths();

    const plugins: esbuild.Plugin[] = [createNextShimPlugin(), createExternalUrlPlugin()];

    // If we have in-memory source code that differs from disk, use the override plugin
    plugins.push(createCodeOverridePlugin(absTarget, sourceCode));

    const result = await withTimeout(
      esbuild.build({
        stdin: {
          contents: entrySource,
          resolveDir: ctx.worktreePath,
          loader: "tsx",
        },
        absWorkingDir: ctx.worktreePath,
        bundle: true,
        format: "iife",
        write: false,
        minify: false,
        target: ["es2020"],
        jsx: "automatic",
        jsxImportSource: "react",
        logLevel: "silent",
        treeShaking: false,
        sourcemap: false,
        platform: "browser",
        define: {
          "process.env.NODE_ENV": '"development"',
          "process.env.__NEXT_TRAILING_SLASH": 'false',
          "process.env.__NEXT_I18N_SUPPORT": 'false',
          "process.env.__NEXT_HAS_REWRITES": 'false',
          "process.env.__NEXT_MANUAL_CLIENT_BASE_PATH": '""',
          "process.env.__NEXT_CROSS_ORIGIN": '""',
          "process.env.__NEXT_ROUTER_BASEPATH": '""',
          "process.env.__NEXT_ACTIONS_DEPLOYMENT_ID": '""',
          "process.env.__NEXT_OPTIMISTIC_CLIENT_CACHE": 'true',
        },
        alias,
        loader: {
          ".woff2": "dataurl",
          ".woff": "dataurl",
          ".ttf": "dataurl",
          ".otf": "dataurl",
          ".eot": "dataurl",
          ".svg": "dataurl",
          ".png": "dataurl",
          ".jpg": "dataurl",
          ".jpeg": "dataurl",
          ".gif": "dataurl",
          ".webp": "dataurl",
        },
        nodePaths: [this.worktreeNodeModules],
        plugins,
        ...(tsconfigRaw ? { tsconfigRaw } : {}),
      }),
      COMPILE_TIMEOUT_MS,
      "React component compilation",
    );

    const warnings = result.warnings.map((w) => w.text);
    const diagnostics = result.warnings.map((w) => ({
      text: w.text,
      location: toDiagnosticLocation(w.location ?? undefined),
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

  private async loadTsconfigPaths(): Promise<string | undefined> {
    if (!this.tsconfigPath || !this.ctx?.config.useProjectTsConfig) {
      return undefined;
    }

    try {
      const raw = await fs.readFile(this.tsconfigPath, "utf-8");
      // Strip comments for JSON parsing (simple line-comment strip)
      const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const parsed = JSON.parse(stripped);

      // Only pass compilerOptions to esbuild's tsconfigRaw
      return JSON.stringify({
        compilerOptions: {
          ...parsed.compilerOptions,
          // Override some options for browser/preview compatibility
          jsx: "react-jsx",
          jsxImportSource: "react",
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2020",
        },
      });
    } catch {
      // If tsconfig is unreadable, skip it
      return undefined;
    }
  }

  private async buildTailwindCss(componentCode: string): Promise<string> {
    const ctx = this.ctx!;

    // If the project does not use tailwind, return empty CSS
    if (ctx.framework.cssFramework !== "tailwind") {
      return "";
    }

    try {
      let config: Config;

      if (this.tailwindConfigPath && ctx.config.useProjectTailwindConfig) {
        // Load project's tailwind config and override content to scan the component code
        try {
          // Dynamic require of project tailwind config (JS/CJS)
          const ext = extname(this.tailwindConfigPath);
          if (ext === ".ts") {
            // TypeScript configs cannot be directly required; use a minimal config
            config = {
              content: [{ raw: componentCode, extension: "tsx" }],
            };
          } else {
            // Clear require cache for fresh load
            // eslint-disable-next-line no-eval
            const runtimeRequire = eval("require") as NodeRequire;
            delete runtimeRequire.cache[runtimeRequire.resolve(this.tailwindConfigPath)];
            const projectConfig = runtimeRequire(this.tailwindConfigPath) as Partial<Config>;
            config = {
              ...projectConfig,
              content: [{ raw: componentCode, extension: "tsx" }],
            };
          }
        } catch {
          // Fallback to minimal config if project config fails to load
          config = {
            content: [{ raw: componentCode, extension: "tsx" }],
          };
        }
      } else {
        config = {
          content: [{ raw: componentCode, extension: "tsx" }],
        };
      }

      const result = await withTimeout(
        postcss([tailwindcss(config)]).process(TAILWIND_INPUT_SOURCE, {
          from: join(ctx.worktreePath, "tailwind-input.css"),
        }),
        TAILWIND_TIMEOUT_MS,
        "Tailwind CSS build",
      );

      return result.css;
    } catch {
      // If tailwind fails, return empty CSS rather than crashing the whole render
      return "";
    }
  }
}
