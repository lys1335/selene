import { sanitizeHTML } from "@/lib/design/utils/sanitize";
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
const HTML_FORBIDDEN_MARKUP = [/<script[\s>]/i, /<iframe[\s>]/i, /<object[\s>]/i, /<embed[\s>]/i];
const DANGEROUS_STYLE_PATTERNS = [
  /expression\s*\([^)]*\)/gi,
  /@import[^;]+;?/gi,
  /-moz-binding\s*:[^;]+;?/gi,
  /url\(\s*['"]?javascript:[^)]+\)/gi,
];
/** Strict CSP for HTML-only previews — no script execution, no form submissions. */
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
  "script-src 'none'",
].join("; ");

/** Permissive CSP for Tailwind/React previews — needs eval for Babel + CDN imports. */
const TAILWIND_PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "img-src https: http: data: blob:",
  "media-src https: http: data: blob:",
  "font-src https: http: data:",
  "style-src 'unsafe-inline' https://cdn.tailwindcss.com",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://esm.sh",
  "connect-src https://esm.sh https://cdn.tailwindcss.com https://unpkg.com",
].join("; ");

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

function containsForbiddenHtmlMarkup(code: string): boolean {
  return HTML_FORBIDDEN_MARKUP.some((pattern) => pattern.test(code));
}

function sanitizeStyleBlock(styleBlock: string): string {
  let sanitized = styleBlock;
  for (const pattern of DANGEROUS_STYLE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
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

function sanitizeExportMarkup(code: string): string {
  const styleBlocks: string[] = [];
  const placeholderPrefix = "__SELENE_STYLE_BLOCK_";

  const withoutStyles = code.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    const token = `${placeholderPrefix}${styleBlocks.length}__`;
    styleBlocks.push(sanitizeStyleBlock(match));
    return token;
  });

  const sanitized = sanitizeHTML(withoutStyles, { isAIContent: true, allowStyles: true });
  return sanitized.replace(new RegExp(`${placeholderPrefix}(\\d+)__`, "g"), (_match, index: string) => {
    return styleBlocks[Number(index)] ?? "";
  });
}

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

function clampProgress(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function buildAnimatedRootStyles(animated?: boolean): string[] {
  return [
    "    #selene-design-preview-root {",
    "      width: 100%;",
    "      min-height: 100vh;",
    "      will-change: transform, filter;",
    animated
      ? "      transform: translate3d(0, calc((0.5 - var(--export-progress)) * 12px), 0) scale(calc(1 + var(--export-progress) * 0.035));"
      : "      transform: none;",
    animated
      ? "      filter: saturate(calc(0.96 + var(--export-progress) * 0.08));"
      : "      filter: none;",
    "      transform-origin: center center;",
    "    }",
  ];
}

function escapeInlineScript(source: string): string {
  return source.replace(/<\//g, "<\\/");
}

function serializeForInlineScript(source: string): string {
  return JSON.stringify(source).replace(/<\//g, "<\\/");
}

type ImportTarget = "ReactModule" | "LucideReact" | "FramerMotion";

function buildNamedDestructure(specifiers: string, target: ImportTarget): string[] {
  const parsed = specifiers
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliasParts = part.split(/\s+as\s+/i).map((value) => value.trim());
      return aliasParts.length === 2 ? `${aliasParts[0]}: ${aliasParts[1]}` : aliasParts[0];
    });

  if (parsed.length === 0) {
    return [];
  }

  return [`const { ${parsed.join(", ")} } = ${target};`];
}

function buildImportPrelude(clause: string, source: string): string[] {
  const trimmedClause = clause.trim();

  if (source === "react") {
    if (trimmedClause.startsWith("* as ")) {
      return [`const ${trimmedClause.slice(5).trim()} = ReactModule;`];
    }

    const namedOnly = trimmedClause.match(/^\{([\s\S]+)\}$/);
    if (namedOnly) {
      return buildNamedDestructure(namedOnly[1], "ReactModule");
    }

    const mixed = trimmedClause.match(/^([^,{]+?)\s*,\s*\{([\s\S]+)\}$/);
    if (mixed) {
      return [`const ${mixed[1].trim()} = ReactModule;`, ...buildNamedDestructure(mixed[2], "ReactModule")];
    }

    return [`const ${trimmedClause} = ReactModule;`];
  }

  if (source === "lucide-react") {
    if (trimmedClause.startsWith("* as ")) {
      return [`const ${trimmedClause.slice(5).trim()} = LucideReact;`];
    }

    const namedOnly = trimmedClause.match(/^\{([\s\S]+)\}$/);
    return namedOnly ? buildNamedDestructure(namedOnly[1], "LucideReact") : [];
  }

  if (source === "framer-motion") {
    if (trimmedClause.startsWith("* as ")) {
      return [`const ${trimmedClause.slice(5).trim()} = FramerMotion;`];
    }

    const namedOnly = trimmedClause.match(/^\{([\s\S]+)\}$/);
    if (namedOnly) {
      return buildNamedDestructure(namedOnly[1], "FramerMotion");
    }

    const mixed = trimmedClause.match(/^([^,{]+?)\s*,\s*\{([\s\S]+)\}$/);
    if (mixed) {
      return [`const ${mixed[1].trim()} = FramerMotion;`, ...buildNamedDestructure(mixed[2], "FramerMotion")];
    }

    return [`const ${trimmedClause} = FramerMotion;`];
  }

  throw new Error(`Unsupported import source in Tailwind preview: ${source}`);
}

function extractImports(code: string): { source: string; preludeLines: string[] } {
  const preludeLines: string[] = [];
  const source = code.replace(/^import\s+([\s\S]+?)\s+from\s+["']([^"']+)["'];?\s*$/gm, (_match, clause: string, importSource: string) => {
    preludeLines.push(...buildImportPrelude(clause, importSource));
    return "";
  });

  return {
    source: source.trim(),
    preludeLines,
  };
}

function normalizeReactComponentSource(code: string): string {
  const trimmed = code.trim();

  const namedDefault = trimmed.match(/export\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (namedDefault) {
    const componentName = namedDefault[1];
    return `${trimmed.replace(/export\s+default\s+function\s+/, "function ")}\nwindow.__SELENE_COMPONENT__ = ${componentName};`;
  }

  if (/export\s+default\s+function\s*\(/.test(trimmed)) {
    const componentName = "GeneratedComponent";
    return `${trimmed.replace(/export\s+default\s+function\s*\(/, `function ${componentName}(`)}\nwindow.__SELENE_COMPONENT__ = ${componentName};`;
  }

  const exportedIdentifier = trimmed.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?$/m);
  if (exportedIdentifier) {
    const componentName = exportedIdentifier[1];
    return `${trimmed.replace(/export\s+default\s+[A-Za-z_$][\w$]*\s*;?$/m, "")}\nwindow.__SELENE_COMPONENT__ = ${componentName};`;
  }

  const namedFunction = trimmed.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (namedFunction) {
    const componentName = namedFunction[1];
    return `${trimmed}\nwindow.__SELENE_COMPONENT__ = ${componentName};`;
  }

  const componentName = "GeneratedComponent";
  return `function ${componentName}() {\n  return (\n${indent(trimmed, 4)}\n  );\n}\nwindow.__SELENE_COMPONENT__ = ${componentName};`;
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
    "    html, body { margin: 0; min-height: 100%; width: 100%; overflow: hidden; background: #ffffff; }",
    "    body { position: relative; font-family: ui-sans-serif, system-ui, sans-serif; }",
    ...buildAnimatedRootStyles(animated),
    "  </style>",
  ];
}

function buildHtmlPreviewHtml(code: string, title: string, animated?: boolean, exportProgress?: number): string {
  const safeMarkup = sanitizeExportMarkup(code);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    ...buildHead(title, HTML_PREVIEW_CSP, animated, exportProgress),
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root" data-preview-ready="true">',
    safeMarkup,
    "  </div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildTailwindPreviewHtml(code: string, title: string, animated?: boolean, exportProgress?: number): string {
  const extracted = extractImports(code);
  const componentSource = normalizeReactComponentSource(extracted.source);
  const runtimeSource = [
    "const React = ReactModule;",
    ...extracted.preludeLines,
    componentSource,
    "const Component = window.__SELENE_COMPONENT__ || module.exports.default || exports.default || (() => null);",
    "const root = createRoot(document.getElementById('selene-design-preview-root'));",
    "root.render(React.createElement(Component));",
  ].join("\n\n");

  const errorStyle = "padding:16px;white-space:pre-wrap;font-family:ui-monospace,monospace;background:#111827;color:#f9fafb;";
  const serializedRuntimeSource = serializeForInlineScript(runtimeSource);
  const loaderScript = escapeInlineScript(
    [
      "window.__SELENE_PREVIEW_READY__ = false;",
      "(async () => {",
      "  try {",
      '    const [reactModule, reactDomClient, LucideReact, FramerMotion] = await Promise.all([',
      '      import("https://esm.sh/react@19"),',
      '      import("https://esm.sh/react-dom@19/client"),',
      '      import("https://esm.sh/lucide-react@0.468.0"),',
      '      import("https://esm.sh/framer-motion@12.23.24"),',
      "    ]);",
      "    const ReactModule = reactModule.default || reactModule;",
      "    const { createRoot } = reactDomClient;",
      "    const module = { exports: {} };",
      "    const exports = module.exports;",
      `    const source = ${serializedRuntimeSource};`,
      "    if (!window.Babel) {",
      '      throw new Error("Babel runtime did not load for design preview.");',
      "    }",
      "    const transformed = window.Babel.transform(source, {",
      '      presets: [["react", { runtime: "classic" }]],',
      '      sourceType: "script",',
      "    }).code;",
      "    const execute = new Function(",
      '      "ReactModule",',
      '      "createRoot",',
      '      "LucideReact",',
      '      "FramerMotion",',
      '      "module",',
      '      "exports",',
      "      transformed",
      "    );",
      "    execute(ReactModule, createRoot, LucideReact, FramerMotion, module, exports);",
      "  } catch (error) {",
      '    const root = document.getElementById("selene-design-preview-root");',
      "    if (root) {",
      '      const pre = document.createElement("pre");',
      `      pre.setAttribute("style", ${JSON.stringify(errorStyle)});`,
      "      pre.textContent = String(error);",
      "      root.replaceChildren(pre);",
      "    }",
      "  } finally {",
      "    window.__SELENE_PREVIEW_READY__ = true;",
      "  }",
      "})();",
    ].join("\n")
  );

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    ...buildHead(title, TAILWIND_PREVIEW_CSP, animated, exportProgress),
    '  <script src="https://cdn.tailwindcss.com"></script>',
    '  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
    "</head>",
    "<body>",
    '  <div id="selene-design-preview-root"></div>',
    `  <script type="module">${loaderScript}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export function buildDesignPreviewHtml(options: BuildDesignPreviewOptions): string {
  const code = options.code.trim();
  if (!code) {
    throw new Error("Component code is required to build a preview.");
  }

  const title = (options.componentName || DEFAULT_COMPONENT_NAME).trim() || DEFAULT_COMPONENT_NAME;
  const mode = inferDesignMode(code, options.mode);

  if (mode === "tailwind") {
    return buildTailwindPreviewHtml(code, title, options.animated, options.exportProgress);
  }

  if (containsForbiddenHtmlMarkup(code)) {
    throw new Error("Preview blocked because the component contains forbidden HTML markup.");
  }

  return buildHtmlPreviewHtml(code, title, options.animated, options.exportProgress);
}
