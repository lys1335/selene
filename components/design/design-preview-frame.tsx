"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDesignWorkspaceStore, DESIGN_BREAKPOINTS } from "@/lib/design/workspace";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Monitor, Tablet, Smartphone, Crosshair, Maximize } from "lucide-react";
import type { InspectedElement } from "@/lib/design/workspace/types";
import { getInspectorScript } from "@/lib/design/workspace/inspector-script";

const BREAKPOINT_ICONS: Record<string, ReactNode> = {
  responsive: <Maximize className="h-4 w-4" />,
  mobile: <Smartphone className="h-4 w-4" />,
  tablet: <Tablet className="h-4 w-4" />,
  desktop: <Monitor className="h-4 w-4" />,
};

// ---------------------------------------------------------------------------
// Inspector script — uses shared module. Starts active for srcDoc injection.
// ---------------------------------------------------------------------------
const INSPECTOR_SCRIPT = getInspectorScript("active");

// ---------------------------------------------------------------------------
// Theme injection for preview iframes.
//
// The theme provider only mutates the main document. Preview iframes have
// their own document, so without explicit injection they get hardcoded
// class="dark" and ember-only CSS variables — causing blank/wrong renders
// when the user is on a different theme or preset.
// ---------------------------------------------------------------------------

/**
 * Read current computed CSS custom properties from the app document and
 * return them as a CSS :root{} block. This captures whatever preset the
 * user has active without hardcoding any specific preset's variables.
 */
function captureThemeCssVars(): string {
  if (typeof document === "undefined") return "";
  const root = document.documentElement;
  const computed = getComputedStyle(root);

  // Capture all --variable declarations from the root
  const vars: string[] = [];
  // Iterate over all CSS properties — getComputedStyle includes custom properties
  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (prop.startsWith("--")) {
      vars.push(`  ${prop}: ${computed.getPropertyValue(prop).trim()};`);
    }
  }

  if (vars.length === 0) return "";
  return `:root {\n${vars.join("\n")}\n}`;
}

/**
 * Apply theme class, data-theme-preset attribute, and CSS variables to
 * srcDoc HTML. Replaces the hardcoded class="dark" with the current theme.
 */
function applyThemeToHtml(
  html: string,
  themeClass: string,
  themePreset: string,
): string {
  // Replace hardcoded class="dark" or class="light" on <html>
  let result = html.replace(
    /(<html[^>]*)\bclass="[^"]*"/,
    `$1class="${themeClass}"`,
  );

  // Add data-theme-preset attribute
  result = result.replace(
    /(<html[^>]*)(>)/,
    `$1 data-theme-preset="${themePreset}"$2`,
  );

  // Inject computed CSS variables before </head> so they override any
  // hardcoded preset CSS (e.g. the ember-only PREVIEW_THEME_CSS).
  const themeCssVars = captureThemeCssVars();
  if (themeCssVars) {
    const styleBlock = `<style data-selene-theme-sync>\n${themeCssVars}\n</style>`;
    if (result.includes("</head>")) {
      result = result.replace("</head>", `${styleBlock}\n</head>`);
    } else {
      // Fallback: prepend before body
      result = styleBlock + result;
    }
  }

  return result;
}

/**
 * Inject inspector script into preview HTML when inspector mode is enabled.
 * Appends a <script> tag before the closing </body> or </html> tag.
 */
function injectInspectorScript(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const scriptTag = `<script>${INSPECTOR_SCRIPT}<\/script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${scriptTag}</body>`);
  }
  if (html.includes("</html>")) {
    return html.replace("</html>", `${scriptTag}</html>`);
  }
  return html + scriptTag;
}

/**
 * Measures available space in a container and returns dimensions.
 * Uses ResizeObserver for live updates when the pane resizes.
 */
function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === Math.floor(width) && prev.height === Math.floor(height)
          ? prev
          : { width: Math.floor(width), height: Math.floor(height) }
      );
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function DesignPreviewFrame() {
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const previewHtml = useDesignWorkspaceStore((s) => s.previewHtml);
  const selectedBreakpoint = useDesignWorkspaceStore((s) => s.selectedBreakpoint);
  const setBreakpoint = useDesignWorkspaceStore((s) => s.setBreakpoint);
  const inspectorEnabled = useDesignWorkspaceStore((s) => s.inspectorEnabled);
  const toggleInspector = useDesignWorkspaceStore((s) => s.toggleInspector);
  const toggleSelectedElement = useDesignWorkspaceStore((s) => s.toggleSelectedElement);
  const setSelectedElements = useDesignWorkspaceStore((s) => s.setSelectedElements);
  const projectContext = useDesignWorkspaceStore((s) => s.projectContext);

  // Theme context — used to inject the correct theme into the iframe document
  const { resolvedTheme, themePreset } = useTheme();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const available = useContainerSize(containerRef);

  // ---------------------------------------------------------------------------
  // Derive preview source — single source of truth
  // ---------------------------------------------------------------------------
  const previewUrl = projectContext?.rendererInfo?.previewUrl
    ?? projectContext?.rendererInfo?.baseUrl
    ?? null;

  const previewOrigin = useMemo(() => {
    if (!previewUrl) return null;
    try {
      return new URL(previewUrl).origin;
    } catch {
      return null;
    }
  }, [previewUrl]);

  // ---------------------------------------------------------------------------
  // Inspector message listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "selene-inspector-select" && e.data.element) {
        const element = e.data.element as InspectedElement;
        const action = e.data.action as string | undefined;

        if (action === "add" || action === "remove") {
          toggleSelectedElement(element);
        } else {
          setSelectedElements([element]);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setSelectedElements, toggleSelectedElement]);

  // ---------------------------------------------------------------------------
  // Inspector toggle for dev-server iframes (InspectorProxy "toggle" mode)
  // ---------------------------------------------------------------------------
  const sendInspectorToggle = useCallback(() => {
    if (!previewUrl) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const payload = { type: "selene-inspector-toggle", enabled: inspectorEnabled };
    try {
      win.postMessage(payload, previewOrigin ?? "*");
    } catch {
      win.postMessage(payload, "*");
    }
  }, [inspectorEnabled, previewUrl, previewOrigin]);

  useEffect(() => {
    sendInspectorToggle();
  }, [sendInspectorToggle]);

  // ---------------------------------------------------------------------------
  // Theme sync for previewUrl iframes — send postMessage on theme change
  // ---------------------------------------------------------------------------
  const sendThemeSync = useCallback(() => {
    if (!previewUrl) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const themeCssVars = captureThemeCssVars();
    const payload = {
      type: "selene-theme-sync",
      themeClass: resolvedTheme,
      themePreset,
      themeCssVars,
    };
    try {
      win.postMessage(payload, previewOrigin ?? "*");
    } catch {
      win.postMessage(payload, "*");
    }
  }, [resolvedTheme, themePreset, previewUrl, previewOrigin]);

  useEffect(() => {
    sendThemeSync();
  }, [sendThemeSync]);

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  const isResponsive = selectedBreakpoint.width === 0;
  const PADDING = 24;
  const viewportW = isResponsive ? available.width : selectedBreakpoint.width;
  const viewportH = isResponsive ? available.height : selectedBreakpoint.height;

  const scale = useMemo(() => {
    if (isResponsive) return 1;
    if (available.width === 0 || available.height === 0) return 1;
    const usableW = available.width - PADDING * 2;
    const usableH = available.height - PADDING * 2;
    return Math.min(usableW / viewportW, usableH / viewportH, 1);
  }, [isResponsive, available.width, available.height, viewportW, viewportH]);

  // ---------------------------------------------------------------------------
  // Iframe rendering — two modes only:
  //   1. previewUrl → <iframe src={previewUrl}> (dev-server / proxy)
  //   2. previewHtml → <iframe srcDoc={...}> (compile / sandbox)
  //
  // Both modes now inject the current theme so the preview matches the app.
  // ---------------------------------------------------------------------------

  /** Build themed srcDoc HTML — applies theme class, preset attr, and CSS vars. */
  const themedSrcDoc = useMemo(() => {
    const withInspector = injectInspectorScript(previewHtml, inspectorEnabled);
    return applyThemeToHtml(withInspector, resolvedTheme, themePreset);
  }, [previewHtml, inspectorEnabled, resolvedTheme, themePreset]);

  // --- Early return AFTER all hooks ---
  if (!activeComponentId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select or create a component to preview
      </div>
    );
  }

  function renderIframe(ref: React.RefObject<HTMLIFrameElement | null>) {
    if (previewUrl) {
      return (
        <iframe
          ref={ref}
          src={previewUrl}
          sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
          className="h-full w-full border-0"
          style={{ background: "transparent" }}
          title="Design preview"
          onLoad={() => {
            sendInspectorToggle();
            sendThemeSync();
          }}
        />
      );
    }
    return (
      <iframe
        ref={ref}
        srcDoc={themedSrcDoc}
        sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
        className="h-full w-full border-0"
        style={{ background: "transparent" }}
        title="Design preview"
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Breakpoint toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2" role="tablist" aria-label="Preview breakpoints">
        {DESIGN_BREAKPOINTS.map((bp) => (
          <Button
            key={bp.name}
            variant={selectedBreakpoint.name === bp.name ? "default" : "ghost"}
            size="sm"
            role="tab"
            aria-selected={selectedBreakpoint.name === bp.name}
            aria-label={bp.width ? `${bp.name} breakpoint (${bp.width}px)` : `${bp.name} mode`}
            onClick={() => setBreakpoint(bp)}
            className="gap-1.5"
          >
            {BREAKPOINT_ICONS[bp.name]}
            <span className="capitalize">{bp.name}</span>
            {bp.width > 0 && <span className="text-xs opacity-60">{bp.width}px</span>}
          </Button>
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          variant={inspectorEnabled ? "default" : "ghost"}
          size="sm"
          aria-label="Toggle element inspector"
          aria-pressed={inspectorEnabled}
          onClick={toggleInspector}
          className="gap-1.5"
        >
          <Crosshair className="h-4 w-4" />
          <span>Inspect</span>
        </Button>
      </div>

      {/* Preview area */}
      <div
        ref={containerRef}
        className={`flex flex-1 overflow-auto bg-muted/30 ${isResponsive ? "" : "items-center justify-center"}`}
      >
        {isResponsive ? (
          renderIframe(iframeRef)
        ) : (
          <div
            style={{
              width: viewportW * scale,
              height: viewportH * scale,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: viewportW,
                height: viewportH,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {renderIframe(iframeRef)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
