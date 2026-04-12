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
import { existsSync, readFileSync } from "fs";
import { SANDBOX_NODE_MODULES } from "../libraries";
import { getProjectRoot } from "../../utils/project-root";
import {
  installSandboxPackages,
  installProjectPackages,
  validateWorkspaceDependencies,
  validateProjectDependencies,
  type DependencyValidationResult,
  type DependencyInstallResult,
} from "./dependencies";
import type { FrameworkType } from "./project-detection";
import {
  type DesignWorkspaceAutoInstallSummary,
  type DesignWorkspaceCompilationIssue,
  type DesignWorkspaceCompileReport,
  type DesignWorkspaceConfig,
  type DesignWorkspaceDependencySummary,
  type DesignWorkspaceDiagnostic,
} from "./config";
import { logToolEvent } from "@/lib/ai/tool-registry/logging";
import { escapeHtml } from "./preview";
// Turbopack needs a static import it can trace in server bundles.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- CJS config is loaded as the module default at runtime
import previewTailwindConfig from "../../../tailwind.preview.config.cjs";

const VIRTUAL_COMPONENT_PATH = "__selene_preview_component__";
const VIRTUAL_COMPONENT_NAMESPACE = "selene-preview-component";
const COMPILE_TIMEOUT_MS = 15_000;
const TAILWIND_TIMEOUT_MS = 15_000;
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
].join("\n");

interface BuildTailwindPreviewOptions {
  autoInstallMissingDependencies?: boolean;
  source?: string;
}

interface BuildTailwindPreviewResult {
  html: string;
  report: DesignWorkspaceCompileReport;
}

interface CompileResult {
  code: string;
  warnings: string[];
  diagnostics?: DesignWorkspaceDiagnostic[];
}

class DesignWorkspaceCompileError extends Error {
  report: DesignWorkspaceCompileReport;

  constructor(message: string, report: DesignWorkspaceCompileReport) {
    super(message);
    this.name = "DesignWorkspaceCompileError";
    this.report = report;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

function normalizeDependencySummary(
  value: DependencyValidationResult,
): DesignWorkspaceDependencySummary {
  return {
    manifestPackages: value.manifestPackages,
    importedPackages: value.importedPackages,
    checkedPackages: value.checkedPackages,
    missingManifestPackages: value.missingManifestPackages,
    missingImportedPackages: value.missingImportedPackages,
    missingPackages: value.missingPackages,
  };
}

function normalizeAutoInstallSummary(
  value?: DependencyInstallResult,
): DesignWorkspaceAutoInstallSummary | undefined {
  if (!value) {
    return undefined;
  }

  return {
    attempted: value.attempted,
    success: value.success,
    packages: value.packages,
    packageNames: value.packageNames,
    error: value.error,
  };
}

function toDiagnosticLocation(location?: esbuild.Location): DesignWorkspaceDiagnostic["location"] {
  if (!location?.file) {
    return undefined;
  }

  return {
    file: location.file,
    line: location.line,
    column: location.column,
  };
}

function inferIssueType(message: string): DesignWorkspaceCompilationIssue["type"] {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("could not resolve") ||
    normalized.includes("cannot find module") ||
    normalized.includes("failed to resolve")
  ) {
    return "dependency";
  }
  if (
    normalized.includes("expected") ||
    normalized.includes("unexpected") ||
    normalized.includes("syntax") ||
    normalized.includes("unterminated")
  ) {
    return "syntax";
  }
  if (normalized.includes("type") || normalized.includes("jsx")) {
    return "type";
  }
  if (normalized.includes("runtime") || normalized.includes("render")) {
    return "runtime";
  }
  return "unknown";
}

function buildIssueSuggestion(
  issueType: DesignWorkspaceCompilationIssue["type"],
  message: string,
  dependencyCheck: DependencyValidationResult,
): string | undefined {
  if (issueType === "dependency") {
    const missingPackages = dependencyCheck.missingPackages;
    if (missingPackages.length > 0) {
      return `Install missing workspace packages: ${missingPackages.join(", ")}`;
    }

    const couldResolveMatch = message.match(/["'`](.+?)["'`]/);
    if (couldResolveMatch?.[1]) {
      return `Verify that ${couldResolveMatch[1]} is installed in .selene-workspace/package.json.`;
    }
  }

  if (issueType === "syntax") {
    return "Fix the TSX syntax near the reported location and ensure the file exports a default React component.";
  }

  if (issueType === "type") {
    return "Check JSX usage, component props, and imported symbols for mismatches.";
  }

  return undefined;
}

function toCompilationIssue(
  text: string,
  location: DesignWorkspaceDiagnostic["location"],
  dependencyCheck: DependencyValidationResult,
): DesignWorkspaceCompilationIssue {
  const type = inferIssueType(text);
  return {
    type,
    message: text,
    location,
    suggestion: buildIssueSuggestion(type, text, dependencyCheck),
  };
}

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

/**
 * esbuild plugin that handles external HTTP/HTTPS imports (e.g. Google Fonts CDN URLs).
 *
 * When user code does `import 'https://fonts.googleapis.com/css2?family=...'`,
 * esbuild cannot resolve HTTP URLs as local modules. This plugin intercepts such
 * imports and converts them to a tiny runtime DOM injection:
 *   document.head.appendChild(<link rel="stylesheet" href="...">)
 *
 * This allows Google Fonts and other CDN stylesheet imports to work inside the
 * sandboxed preview iframe without any network requests being blocked by esbuild.
 */
function createExternalUrlPlugin(): esbuild.Plugin {
  return {
    name: "selene-external-url",
    setup(build) {
      // Mark all https:// and http:// imports as handled by this plugin
      build.onResolve({ filter: /^https?:\/\// }, (args) => ({
        path: args.path,
        namespace: "selene-external-url",
      }));

      // For stylesheet URLs (Google Fonts etc.), inject a <link> at runtime
      build.onLoad({ filter: /.*/, namespace: "selene-external-url" }, (args) => {
        const url = args.path;
        const isStylesheet =
          url.includes("fonts.googleapis.com") ||
          url.endsWith(".css") ||
          url.includes("stylesheet");

        if (isStylesheet) {
          // Inject a <link rel="stylesheet"> into the document head at runtime
          return {
            contents: `
              (function() {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = ${JSON.stringify(url)};
                document.head.appendChild(link);
              })();
            `,
            loader: "js",
          };
        }

        // For non-stylesheet external URLs, produce an empty module
        return { contents: "", loader: "js" };
      });
    },
  };
}

async function compileReactComponent(
  componentCode: string,
  dependencyCheck: DependencyValidationResult,
): Promise<CompileResult> {
  try {
    const result = await withTimeout(
      esbuild.build({
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
        treeShaking: false,
        sourcemap: false,
        platform: "browser",
        define: {
          "process.env.NODE_ENV": '"development"',
        },
        alias: {
          "react": resolve(PROJECT_ROOT, "node_modules/react"),
          "react-dom": resolve(PROJECT_ROOT, "node_modules/react-dom"),
          "react/jsx-runtime": resolve(PROJECT_ROOT, "node_modules/react/jsx-runtime"),
          "react/jsx-dev-runtime": resolve(PROJECT_ROOT, "node_modules/react/jsx-dev-runtime"),
        },
        loader: {
          ".woff2": "dataurl",
          ".woff": "dataurl",
          ".ttf": "dataurl",
          ".otf": "dataurl",
          ".eot": "dataurl",
        },
        nodePaths: [SANDBOX_NODE_MODULES],
        plugins: [createExternalUrlPlugin(), createComponentPlugin(componentCode)],
      }),
      COMPILE_TIMEOUT_MS,
      "Design preview compilation",
    );

    const warnings = result.warnings.map((warning) => warning.text);
    const diagnostics = result.warnings.map((warning) => ({
      text: warning.text,
      location: toDiagnosticLocation(warning.location ?? undefined),
    }));

    if (result.outputFiles.length === 0) {
      throw new Error("esbuild produced no output files");
    }

    return {
      code: result.outputFiles[0].text,
      warnings,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    };
  } catch (error) {
    if (error instanceof DesignWorkspaceCompileError) {
      throw error;
    }

    const errors =
      typeof error === "object" && error !== null && "errors" in error && Array.isArray((error as { errors?: unknown[] }).errors)
        ? ((error as { errors: esbuild.Message[] }).errors ?? [])
        : [];

    const warnings =
      typeof error === "object" && error !== null && "warnings" in error && Array.isArray((error as { warnings?: unknown[] }).warnings)
        ? ((error as { warnings: esbuild.Message[] }).warnings ?? []).map((warning) => warning.text)
        : [];

    const diagnostics =
      typeof error === "object" && error !== null && "warnings" in error && Array.isArray((error as { warnings?: unknown[] }).warnings)
        ? ((error as { warnings: esbuild.Message[] }).warnings ?? []).map((warning) => ({
            text: warning.text,
            location: toDiagnosticLocation(warning.location ?? undefined),
          }))
        : undefined;

    const issueList = errors.length > 0
      ? errors.map((issue) =>
          toCompilationIssue(
            issue.text,
            toDiagnosticLocation(issue.location ?? undefined),
            dependencyCheck,
          ),
        )
      : [
          toCompilationIssue(
            error instanceof Error ? error.message : "Compilation failed.",
            undefined,
            dependencyCheck,
          ),
        ];

    throw new DesignWorkspaceCompileError(
      issueList[0]?.message ?? "Compilation failed.",
      {
        warnings,
        diagnostics,
        errors: issueList,
        dependencyCheck: normalizeDependencySummary(dependencyCheck),
        recovered: false,
        durationMs: 0,
      },
    );
  }
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

async function buildPreviewTailwindCss(componentCode: string): Promise<string> {
  try {
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

    const result = await withTimeout(
      postcss([tailwindcss(config)]).process(PREVIEW_TAILWIND_SOURCE, {
        from: TAILWIND_INPUT_PATH,
      }),
      TAILWIND_TIMEOUT_MS,
      "Tailwind preview build",
    );

    return result.css;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Tailwind preview build failed.");
  }
}

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
    "  <!-- Allow Google Fonts and other external font CDNs -->",
    '  <link rel="preconnect" href="https://fonts.googleapis.com" />',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />',
    "  <style>",
    safeThemeCss,
    "  </style>",
    "  <style>",
    safeCss,
    "  </style>",
    "  <style>",
    "    html, body, #selene-design-preview-root { margin: 0; width: 100%; height: 100%; }",
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

function createMissingDependencyIssues(
  dependencyCheck: DependencyValidationResult,
): DesignWorkspaceCompilationIssue[] {
  return dependencyCheck.missingPackages.map((packageName) => ({
    type: "dependency",
    message: `Cannot resolve workspace package \"${packageName}\".`,
    suggestion: `Install ${packageName} in .selene-workspace/package.json or allow automatic recovery to install it.`,
  }));
}

function buildReportMessage(report: DesignWorkspaceCompileReport): string {
  const primary = report.errors[0]?.message;
  if (primary) {
    return primary;
  }

  if (report.dependencyCheck.missingPackages.length > 0) {
    return `Missing dependencies: ${report.dependencyCheck.missingPackages.join(", ")}`;
  }

  return "Design preview compilation failed.";
}

function logCompilerFailure(
  source: string,
  report: DesignWorkspaceCompileReport,
  message: string,
): void {
  logToolEvent({
    level: "error",
    toolName: "designWorkspaceCompiler",
    event: "error",
    error: message,
    metadata: {
      source,
      recovered: report.recovered,
      missingPackages: report.dependencyCheck.missingPackages,
      autoInstall: report.autoInstall,
      errors: report.errors,
    },
  });
}

export function isDesignWorkspaceCompileError(
  error: unknown,
): error is DesignWorkspaceCompileError {
  return error instanceof DesignWorkspaceCompileError;
}

export async function buildTailwindPreviewWithMetadata(
  componentCode: string,
  title: string,
  options: BuildTailwindPreviewOptions = {},
): Promise<BuildTailwindPreviewResult> {
  const startedAt = Date.now();
  const source = options.source ?? "design-workspace";
  let dependencyCheck = await validateWorkspaceDependencies(componentCode);
  let autoInstall: DesignWorkspaceAutoInstallSummary | undefined;
  let recovered = false;

  if (
    dependencyCheck.missingPackages.length > 0 &&
    options.autoInstallMissingDependencies !== false
  ) {
    logToolEvent({
      level: "warn",
      toolName: "designWorkspaceCompiler",
      event: "retry",
      error: `Missing dependencies detected: ${dependencyCheck.missingPackages.join(", ")}`,
      metadata: {
        source,
        missingPackages: dependencyCheck.missingPackages,
      },
    });

    autoInstall = normalizeAutoInstallSummary(
      await installSandboxPackages(dependencyCheck.missingPackages),
    );

    if (autoInstall?.success) {
      recovered = true;
      dependencyCheck = await validateWorkspaceDependencies(componentCode);
    }
  }

  if (dependencyCheck.missingPackages.length > 0) {
    const report: DesignWorkspaceCompileReport = {
      warnings: [],
      errors: createMissingDependencyIssues(dependencyCheck),
      dependencyCheck: normalizeDependencySummary(dependencyCheck),
      autoInstall,
      recovered,
      durationMs: Date.now() - startedAt,
    };
    const message = buildReportMessage(report);
    logCompilerFailure(source, report, message);
    throw new DesignWorkspaceCompileError(message, report);
  }

  try {
    const compileResult = await compileReactComponent(componentCode, dependencyCheck);
    const tailwindCss = await buildPreviewTailwindCss(componentCode);
    const report: DesignWorkspaceCompileReport = {
      warnings: compileResult.warnings,
      diagnostics: compileResult.diagnostics,
      errors: [],
      dependencyCheck: normalizeDependencySummary(dependencyCheck),
      autoInstall,
      recovered,
      durationMs: Date.now() - startedAt,
    };

    if (recovered) {
      logToolEvent({
        level: "info",
        toolName: "designWorkspaceCompiler",
        event: "success",
        durationMs: report.durationMs,
        metadata: {
          source,
          recovered,
          autoInstall,
        },
      });
    }

    return {
      html: buildCompiledPreviewHtml(compileResult.code, tailwindCss, title),
      report,
    };
  } catch (error) {
    const baseReport =
      error instanceof DesignWorkspaceCompileError
        ? error.report
        : {
            warnings: [],
            errors: [
              toCompilationIssue(
                error instanceof Error ? error.message : "Compilation failed.",
                undefined,
                dependencyCheck,
              ),
            ],
            dependencyCheck: normalizeDependencySummary(dependencyCheck),
            recovered: false,
            durationMs: 0,
          } satisfies DesignWorkspaceCompileReport;

    const report: DesignWorkspaceCompileReport = {
      ...baseReport,
      dependencyCheck: baseReport.dependencyCheck ?? normalizeDependencySummary(dependencyCheck),
      autoInstall: baseReport.autoInstall ?? autoInstall,
      recovered,
      durationMs: Date.now() - startedAt,
    };

    const message = buildReportMessage(report);
    logCompilerFailure(source, report, message);
    throw new DesignWorkspaceCompileError(message, report);
  }
}

export async function buildTailwindPreviewAsync(
  componentCode: string,
  title: string,
): Promise<string> {
  const { html } = await buildTailwindPreviewWithMetadata(componentCode, title, {
    autoInstallMissingDependencies: true,
    source: "design-workspace-preview",
  });
  return html;
}

// ---------------------------------------------------------------------------
// Project-native compilation
// ---------------------------------------------------------------------------

/**
 * esbuild plugin that injects the user component from a virtual module,
 * resolving relative imports from the project worktree (not PROJECT_ROOT).
 */
function createProjectComponentPlugin(
  componentCode: string,
  resolveDir: string,
): esbuild.Plugin {
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
        resolveDir,
      }));
    },
  };
}

/**
 * Compile a React component within the context of a user project.
 *
 * Unlike `buildTailwindPreviewWithMetadata()` (sandbox mode), this function:
 * - Sets esbuild's `absWorkingDir` to `worktreePath`
 * - Resolves imports from `worktreePath/node_modules`
 * - Loads tsconfig from `worktreePath/tsconfig.json` if available
 * - Loads project tailwind config when `config.useProjectTailwindConfig` is set
 * - On missing-module failures, attempts `installProjectPackages()` and retries once
 */
export async function compileProjectComponent(
  code: string,
  worktreePath: string,
  _framework: FrameworkType,
  config: DesignWorkspaceConfig,
): Promise<DesignWorkspaceCompileReport> {
  const startedAt = Date.now();
  const projectNodeModules = resolve(worktreePath, "node_modules");
  const source = "design-workspace-project";

  // Validate dependencies against the project's node_modules
  let dependencyCheck = await validateProjectDependencies(
    code,
    projectNodeModules,
  );
  let autoInstall: DesignWorkspaceAutoInstallSummary | undefined;
  let recovered = false;

  // Auto-install missing deps if enabled
  if (
    dependencyCheck.missingPackages.length > 0 &&
    config.autoInstallProjectDeps
  ) {
    logToolEvent({
      level: "warn",
      toolName: "designWorkspaceCompiler",
      event: "retry",
      error: `Missing project dependencies: ${dependencyCheck.missingPackages.join(", ")}`,
      metadata: { source, missingPackages: dependencyCheck.missingPackages },
    });

    autoInstall = normalizeAutoInstallSummary(
      await installProjectPackages(worktreePath, dependencyCheck.missingPackages),
    );

    if (autoInstall?.success) {
      recovered = true;
      dependencyCheck = await validateProjectDependencies(code, projectNodeModules);
    }
  }

  // Bail out early if deps are still missing after install attempt
  if (dependencyCheck.missingPackages.length > 0) {
    const report: DesignWorkspaceCompileReport = {
      warnings: [],
      errors: createMissingDependencyIssues(dependencyCheck),
      dependencyCheck: normalizeDependencySummary(dependencyCheck),
      autoInstall,
      recovered,
      durationMs: Date.now() - startedAt,
    };
    const message = buildReportMessage(report);
    logCompilerFailure(source, report, message);
    throw new DesignWorkspaceCompileError(message, report);
  }

  // Build esbuild alias map — prefer project's react copies if available
  const alias: Record<string, string> = {};
  const reactDir = resolve(projectNodeModules, "react");
  const reactDomDir = resolve(projectNodeModules, "react-dom");
  if (existsSync(reactDir)) {
    alias["react"] = reactDir;
    alias["react/jsx-runtime"] = resolve(reactDir, "jsx-runtime");
    alias["react/jsx-dev-runtime"] = resolve(reactDir, "jsx-dev-runtime");
  } else {
    alias["react"] = resolve(PROJECT_ROOT, "node_modules/react");
    alias["react/jsx-runtime"] = resolve(PROJECT_ROOT, "node_modules/react/jsx-runtime");
    alias["react/jsx-dev-runtime"] = resolve(PROJECT_ROOT, "node_modules/react/jsx-dev-runtime");
  }
  if (existsSync(reactDomDir)) {
    alias["react-dom"] = reactDomDir;
  } else {
    alias["react-dom"] = resolve(PROJECT_ROOT, "node_modules/react-dom");
  }

  // Optionally load tsconfig from the project
  const tsconfigRaw: string | undefined = (() => {
    if (!config.useProjectTsConfig) return undefined;
    const tsconfigPath = resolve(worktreePath, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        return readFileSync(tsconfigPath, "utf8");
      } catch {
        return undefined;
      }
    }
    return undefined;
  })();

  try {
    const compileResult = await compileProjectReactComponent(
      code,
      worktreePath,
      projectNodeModules,
      alias,
      tsconfigRaw,
      dependencyCheck,
    );

    // Build Tailwind CSS — use project config if available and enabled
    const tailwindCss = config.useProjectTailwindConfig
      ? await buildProjectTailwindCss(code, worktreePath)
      : await buildPreviewTailwindCss(code);

    const report: DesignWorkspaceCompileReport = {
      warnings: compileResult.warnings,
      diagnostics: compileResult.diagnostics,
      errors: [],
      dependencyCheck: normalizeDependencySummary(dependencyCheck),
      autoInstall,
      recovered,
      durationMs: Date.now() - startedAt,
    };

    if (recovered) {
      logToolEvent({
        level: "info",
        toolName: "designWorkspaceCompiler",
        event: "success",
        durationMs: report.durationMs,
        metadata: { source, recovered, autoInstall },
      });
    }

    return report;
  } catch (error) {
    // If compilation failed due to missing modules, try installing and retrying once
    if (
      !recovered &&
      config.autoInstallProjectDeps &&
      error instanceof DesignWorkspaceCompileError &&
      error.report.errors.some((e) => e.type === "dependency")
    ) {
      const depNames = error.report.errors
        .filter((e) => e.type === "dependency")
        .map((e) => {
          const m = e.message.match(/["'`](.+?)["'`]/);
          return m?.[1];
        })
        .filter((n): n is string => !!n);

      if (depNames.length > 0) {
        const retryInstall = await installProjectPackages(worktreePath, depNames);
        if (retryInstall.success) {
          // Retry compilation once
          return compileProjectComponent(code, worktreePath, _framework, {
            ...config,
            autoInstallProjectDeps: false, // prevent infinite recursion
          });
        }
      }
    }

    const baseReport =
      error instanceof DesignWorkspaceCompileError
        ? error.report
        : {
            warnings: [],
            errors: [
              toCompilationIssue(
                error instanceof Error ? error.message : "Compilation failed.",
                undefined,
                dependencyCheck,
              ),
            ],
            dependencyCheck: normalizeDependencySummary(dependencyCheck),
            recovered: false,
            durationMs: 0,
          } satisfies DesignWorkspaceCompileReport;

    const report: DesignWorkspaceCompileReport = {
      ...baseReport,
      dependencyCheck: baseReport.dependencyCheck ?? normalizeDependencySummary(dependencyCheck),
      autoInstall: baseReport.autoInstall ?? autoInstall,
      recovered,
      durationMs: Date.now() - startedAt,
    };

    const message = buildReportMessage(report);
    logCompilerFailure(source, report, message);
    throw new DesignWorkspaceCompileError(message, report);
  }
}

/** esbuild compilation targeting a project worktree. */
async function compileProjectReactComponent(
  componentCode: string,
  worktreePath: string,
  projectNodeModules: string,
  alias: Record<string, string>,
  _tsconfigRaw: string | undefined,
  dependencyCheck: DependencyValidationResult,
): Promise<CompileResult> {
  try {
    const result = await withTimeout(
      esbuild.build({
        stdin: {
          contents: createPreviewEntrySource(),
          resolveDir: worktreePath,
          loader: "tsx",
        },
        absWorkingDir: worktreePath,
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
        },
        alias,
        loader: {
          ".woff2": "dataurl",
          ".woff": "dataurl",
          ".ttf": "dataurl",
          ".otf": "dataurl",
          ".eot": "dataurl",
        },
        nodePaths: [projectNodeModules],
        plugins: [
          createExternalUrlPlugin(),
          createProjectComponentPlugin(componentCode, worktreePath),
        ],
      }),
      COMPILE_TIMEOUT_MS,
      "Project design preview compilation",
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
  } catch (error) {
    if (error instanceof DesignWorkspaceCompileError) throw error;

    const errors =
      typeof error === "object" && error !== null && "errors" in error && Array.isArray((error as { errors?: unknown[] }).errors)
        ? ((error as { errors: esbuild.Message[] }).errors ?? [])
        : [];

    const warnings =
      typeof error === "object" && error !== null && "warnings" in error && Array.isArray((error as { warnings?: unknown[] }).warnings)
        ? ((error as { warnings: esbuild.Message[] }).warnings ?? []).map((w) => w.text)
        : [];

    const diagnostics =
      typeof error === "object" && error !== null && "warnings" in error && Array.isArray((error as { warnings?: unknown[] }).warnings)
        ? ((error as { warnings: esbuild.Message[] }).warnings ?? []).map((w) => ({
            text: w.text,
            location: toDiagnosticLocation(w.location ?? undefined),
          }))
        : undefined;

    const issueList = errors.length > 0
      ? errors.map((issue) =>
          toCompilationIssue(issue.text, toDiagnosticLocation(issue.location ?? undefined), dependencyCheck),
        )
      : [
          toCompilationIssue(
            error instanceof Error ? error.message : "Compilation failed.",
            undefined,
            dependencyCheck,
          ),
        ];

    throw new DesignWorkspaceCompileError(
      issueList[0]?.message ?? "Compilation failed.",
      {
        warnings,
        diagnostics,
        errors: issueList,
        dependencyCheck: normalizeDependencySummary(dependencyCheck),
        recovered: false,
        durationMs: 0,
      },
    );
  }
}

/**
 * Build Tailwind CSS using the project's tailwind config if it exists,
 * falling back to the preview config.
 */
async function buildProjectTailwindCss(
  componentCode: string,
  worktreePath: string,
): Promise<string> {
  const configCandidates = [
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
  ];

  let projectConfig: Config | undefined;
  for (const candidate of configCandidates) {
    const configPath = resolve(worktreePath, candidate);
    if (existsSync(configPath)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const loaded = require(configPath) as Config | { default: Config };
        projectConfig = ("default" in loaded ? loaded.default : loaded) as Config;
        break;
      } catch {
        // Fall through to next candidate or default
      }
    }
  }

  const baseConfig = (projectConfig ?? previewTailwindConfig) as unknown as Omit<Config, "content">;
  const config = {
    ...baseConfig,
    content: [{ raw: componentCode, extension: "tsx" }],
  } satisfies Config;

  try {
    const result = await withTimeout(
      postcss([tailwindcss(config)]).process(PREVIEW_TAILWIND_SOURCE, {
        from: TAILWIND_INPUT_PATH,
      }),
      TAILWIND_TIMEOUT_MS,
      "Project Tailwind preview build",
    );
    return result.css;
  } catch (error) {
    // Fall back to default preview config on failure
    return buildPreviewTailwindCss(componentCode);
  }
}
