"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDesignWorkspaceStore, DESIGN_BREAKPOINTS } from "@/lib/design/workspace";
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

/** Simple fast hash for cache invalidation (djb2). */
function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Check if the preview HTML is a loading placeholder (not compiled content). */
function isPlaceholderHtml(html: string): boolean {
  return !html.trim() || html.includes('data-selene-placeholder="true"');
}

/** Escape text for safe inline HTML rendering. */
function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Inspector script — uses shared module. Starts active for srcDoc injection.
// ---------------------------------------------------------------------------
const INSPECTOR_SCRIPT = getInspectorScript("active");

/**
 * Inject inspector script into preview HTML when inspector mode is enabled.
 * Appends a <script> tag before the closing </body> or </html> tag.
 */
function injectInspectorScript(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const scriptTag = `<script>${INSPECTOR_SCRIPT}<\/script>`;
  // Insert before </body> if present, else before </html>, else append
  if (html.includes("</body>")) {
    return html.replace("</body>", `${scriptTag}</body>`);
  }
  if (html.includes("</html>")) {
    return html.replace("</html>", `${scriptTag}</html>`);
  }
  return html + scriptTag;
}

/**
 * When the active component is Tailwind mode and the current previewHtml
 * is just the placeholder, trigger server-side compilation via the API.
 *
 * This handles two cases:
 * 1. Component switching — the store rebuilds the placeholder, and this hook
 *    triggers compilation for the newly active Tailwind component.
 * 2. Fallback — if the tool handler's server-side compilation failed, the
 *    bridge sets the placeholder and this hook retries via the API.
 *
 * The generate/edit flow normally provides compiled HTML directly via the
 * tool result bridge, so this hook is a safety net, not the primary path.
 */
function useCompileTailwindPreview() {
  const components = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const setPreviewHtml = useDesignWorkspaceStore((s) => s.setPreviewHtml);
  const projectCtx = useDesignWorkspaceStore((s) => s.projectContext);

  // Track which component+code hash we last compiled to avoid redundant API calls.
  const lastCompiledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeComponentId) return;

    // In project mode with a running dev-server renderer, the preview is
    // served via the renderer's baseUrl — skip client-side compilation to
    // avoid overwriting server-produced previews.
    if (projectCtx?.rendererInfo?.baseUrl) return;

    const component = components.find((c) => c.id === activeComponentId);
    if (!component) return;

    // Build a content-based cache key using component ID + code hash
    const cacheKey = `${activeComponentId}:${hashCode(component.code)}`;

    // Don't re-request the same content we already compiled
    if (lastCompiledRef.current === cacheKey) return;

    // Capture the component ID at request time for stale-response detection.
    const requestComponentId = activeComponentId;
    const requestCode = component.code;
    const controller = new AbortController();

    fetch("/api/design/compile-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: requestCode, name: component.name }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          html?: string;
          error?: string;
          details?: Array<{ text?: string }>;
        };

        if (!res.ok) {
          const detailText = Array.isArray(data.details)
            ? data.details.map((detail) => detail.text).filter(Boolean).join("\n")
            : "";
          const message = [data.error || `Compile API returned ${res.status}`, detailText]
            .filter(Boolean)
            .join("\n\n");
          throw new Error(message);
        }

        return data;
      })
      .then((data: { html?: string; error?: string }) => {
        const currentId = useDesignWorkspaceStore.getState().activeComponentId;
        if (currentId !== requestComponentId) return;

        if (data.html) {
          lastCompiledRef.current = cacheKey;
          setPreviewHtml(data.html);
        } else if (data.error) {
          const safeError = escapeForHtml(data.error);
          setPreviewHtml(
            `<!DOCTYPE html><html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#f9fafb;"><pre style="white-space:pre-wrap;color:#ef4444;">Compilation Error:\n${safeError}</pre></body></html>`
          );
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[design-preview] compilation failed:", err);
        const currentId = useDesignWorkspaceStore.getState().activeComponentId;
        if (currentId !== requestComponentId) return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        const safeMsg = escapeForHtml(msg);
        setPreviewHtml(
          `<!DOCTYPE html><html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#f9fafb;"><pre style="white-space:pre-wrap;color:#ef4444;">Compilation Failed:\n${safeMsg}</pre></body></html>`
        );
      });

    return () => {
      controller.abort();
    };
  }, [activeComponentId, components, setPreviewHtml, projectCtx]);
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
  const setSelectedElement = useDesignWorkspaceStore((s) => s.setSelectedElement);
  const toggleSelectedElement = useDesignWorkspaceStore((s) => s.toggleSelectedElement);
  const setSelectedElements = useDesignWorkspaceStore((s) => s.setSelectedElements);
  const projectContext = useDesignWorkspaceStore((s) => s.projectContext);

  // Auto-compile Tailwind components when switching or on first load
  useCompileTailwindPreview();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const available = useContainerSize(containerRef);

  // Listen for inspector postMessage from the iframe — validate source
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      // Only accept messages from our own iframe, not arbitrary windows
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "selene-inspector-select" && e.data.element) {
        const element = e.data.element as InspectedElement;
        const action = e.data.action as string | undefined;

        if (action === "add") {
          toggleSelectedElement(element);
        } else if (action === "remove") {
          toggleSelectedElement(element);
        } else {
          // replace — single selection
          setSelectedElements([element]);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setSelectedElements, toggleSelectedElement]);

  // For proxy-backed iframes (dev-server renderers), the inspector script is
  // injected by the InspectorProxy in "toggle" mode (starts inactive). Send a
  // postMessage to activate/deactivate whenever inspectorEnabled changes.
  // Also resend on iframe load (H2 — handles first load and HMR reloads).
  const sendInspectorToggle = useCallback(() => {
    if (!projectContext?.rendererInfo?.baseUrl) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const origin = projectContext.rendererInfo.baseUrl;
    try {
      win.postMessage({ type: "selene-inspector-toggle", enabled: inspectorEnabled }, origin);
    } catch {
      // Cross-origin fallback — proxy is same-origin but just in case
      win.postMessage({ type: "selene-inspector-toggle", enabled: inspectorEnabled }, "*");
    }
  }, [inspectorEnabled, projectContext?.rendererInfo?.baseUrl]);

  useEffect(() => {
    sendInspectorToggle();
  }, [sendInspectorToggle]);

  // Responsive mode: iframe fills the entire container (like a real browser)
  // Fixed breakpoints: scale to fit the container with padding
  const isResponsive = selectedBreakpoint.width === 0;
  const PADDING = 24;
  const viewportW = isResponsive ? available.width : selectedBreakpoint.width;
  const viewportH = isResponsive ? available.height : selectedBreakpoint.height;

  // Compute scale so the true-size iframe fits in the available space.
  // Never upscale (cap at 1). In responsive mode, scale is always 1.
  const computeScale = useCallback(() => {
    if (isResponsive) return 1;
    if (available.width === 0 || available.height === 0) return 1;
    const usableW = available.width - PADDING * 2;
    const usableH = available.height - PADDING * 2;
    return Math.min(usableW / viewportW, usableH / viewportH, 1);
  }, [isResponsive, available.width, available.height, viewportW, viewportH]);

  const scale = computeScale();

  if (!activeComponentId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select or create a component to preview
      </div>
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

      {/* Preview area — measured container */}
      <div
        ref={containerRef}
        className={`flex flex-1 overflow-auto bg-muted/30 ${isResponsive ? "" : "items-center justify-center"}`}
      >
        {isResponsive ? (
          /* Responsive mode: iframe fills container directly — like a real browser */
          projectContext?.rendererInfo?.baseUrl ? (
            <iframe
              ref={iframeRef}
              src={projectContext.rendererInfo.previewUrl ?? `${projectContext.rendererInfo.baseUrl}/${projectContext.castFile ?? ""}`}
              sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
              className="h-full w-full border-0"
              style={{ background: "transparent" }}
              title="Design preview"
              onLoad={sendInspectorToggle}
            />
          ) : (
            <iframe
              ref={iframeRef}
              srcDoc={injectInspectorScript(previewHtml, inspectorEnabled)}
              sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
              className="h-full w-full border-0"
              style={{ background: "transparent" }}
              title="Design preview"
            />
          )
        ) : (
          /* Fixed breakpoint: scale to fit with padding */
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
              {projectContext?.rendererInfo?.baseUrl ? (
                <iframe
                  ref={iframeRef}
                  src={`${projectContext.rendererInfo.baseUrl}/${projectContext.castFile ?? ""}`}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
                  className="h-full w-full border-0"
                  style={{ background: "transparent" }}
                  title="Design preview"
                />
              ) : (
                <iframe
                  ref={iframeRef}
                  srcDoc={injectInspectorScript(previewHtml, inspectorEnabled)}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
                  className="h-full w-full border-0"
                  style={{ background: "transparent" }}
                  title="Design preview"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
