/**
 * Design Preview — placeholder builder for async Tailwind compilation.
 */

export type DesignExportMode = "tailwind";

interface BuildDesignPreviewOptions {
  code: string;
  componentName?: string;
}

const DEFAULT_COMPONENT_NAME = "Design Component";
const ERROR_THEME = {
  background: "#111827",
  foreground: "#f9fafb",
  accent: "#ef4444",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    '<body data-selene-placeholder="true">',
    '  <div class="loader">',
    '    <div class="dot"></div>',
    '    <div class="dot"></div>',
    '    <div class="dot"></div>',
    "    <span>Compiling component...</span>",
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function buildDesignPreviewErrorHtml(
  message: string,
  options: { title?: string; label?: string } = {},
): string {
  const title = (options.title || DEFAULT_COMPONENT_NAME).trim() || DEFAULT_COMPONENT_NAME;
  const label = (options.label || "Preview Error").trim() || "Preview Error";

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    `    html, body { margin: 0; min-height: 100%; width: 100%; background: ${ERROR_THEME.background}; color: ${ERROR_THEME.foreground}; }`,
    "    body { display: flex; }",
    "    .shell { width: 100%; padding: 16px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }",
    `    .label { margin-bottom: 12px; color: ${ERROR_THEME.accent}; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }`,
    `    pre { margin: 0; white-space: pre-wrap; font-size: 13px; line-height: 1.5; color: ${ERROR_THEME.foreground}; }`,
    "  </style>",
    "</head>",
    '<body data-selene-preview-error="true">',
    '  <div class="shell">',
    `    <div class="label">${escapeHtml(label)}</div>`,
    `    <pre>${escapeHtml(message)}</pre>`,
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function buildDesignPreviewHtml(options: BuildDesignPreviewOptions): string {
  const code = options.code.trim();
  if (!code) {
    throw new Error("Component code is required to build a preview.");
  }

  const title = (options.componentName || DEFAULT_COMPONENT_NAME).trim() || DEFAULT_COMPONENT_NAME;
  return buildTailwindPlaceholder(title);
}
