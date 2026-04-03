"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDesignWorkspaceStore, DESIGN_BREAKPOINTS } from "@/lib/design/workspace";
import { Button } from "@/components/ui/button";
import { Monitor, Tablet, Smartphone } from "lucide-react";

const BREAKPOINT_ICONS: Record<string, ReactNode> = {
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
  return !html.trim() || html.includes("Compiling component");
}

/** Escape text for safe inline HTML rendering. */
function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const previewHtml = useDesignWorkspaceStore((s) => s.previewHtml);
  const setPreviewHtml = useDesignWorkspaceStore((s) => s.setPreviewHtml);

  // Track which component+code hash we last compiled to avoid redundant API calls.
  const lastCompiledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeComponentId) return;

    const component = components.find((c) => c.id === activeComponentId);
    if (!component || component.mode !== "tailwind") return;

    // Build a content-based cache key using component ID + code hash
    const cacheKey = `${activeComponentId}:${hashCode(component.code)}`;

    // If preview is already compiled (not a placeholder) AND the cache key
    // matches, the bridge already provided compiled HTML — skip the fetch.
    if (!isPlaceholderHtml(previewHtml) && lastCompiledRef.current === cacheKey) {
      return;
    }

    // Don't re-request the same content
    if (lastCompiledRef.current === cacheKey) return;

    // Capture the component ID at request time for stale-response detection
    const requestComponentId = activeComponentId;
    const requestCode = component.code;

    const controller = new AbortController();

    fetch("/api/design/compile-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: requestCode, name: component.name }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { html?: string; error?: string }) => {
        // Guard: only apply if this component is still active
        const currentId = useDesignWorkspaceStore.getState().activeComponentId;
        if (currentId !== requestComponentId) return;

        if (data.html) {
          lastCompiledRef.current = cacheKey;
          setPreviewHtml(data.html);
        } else if (data.error) {
          // Show compilation error in preview with proper escaping
          const safeError = escapeForHtml(data.error);
          setPreviewHtml(
            `<!DOCTYPE html><html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#f9fafb;"><pre style="white-space:pre-wrap;color:#ef4444;">Compilation Error:\n${safeError}</pre></body></html>`
          );
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[design-preview] compilation failed:", err);
      });

    return () => controller.abort();
  }, [activeComponentId, components, previewHtml, setPreviewHtml]);
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

  // Auto-compile Tailwind components when switching or on first load
  useCompileTailwindPreview();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const available = useContainerSize(containerRef);

  // Padding around the scaled preview inside the container
  const PADDING = 24;
  const viewportW = selectedBreakpoint.width;
  const viewportH = selectedBreakpoint.height;

  // Compute scale so the true-size iframe fits in the available space.
  // Never upscale (cap at 1).
  const computeScale = useCallback(() => {
    if (available.width === 0 || available.height === 0) return 1;
    const usableW = available.width - PADDING * 2;
    const usableH = available.height - PADDING * 2;
    return Math.min(usableW / viewportW, usableH / viewportH, 1);
  }, [available.width, available.height, viewportW, viewportH]);

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
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        {DESIGN_BREAKPOINTS.map((bp) => (
          <Button
            key={bp.name}
            variant={selectedBreakpoint.name === bp.name ? "default" : "ghost"}
            size="sm"
            onClick={() => setBreakpoint(bp)}
            className="gap-1.5"
          >
            {BREAKPOINT_ICONS[bp.name]}
            <span className="capitalize">{bp.name}</span>
            <span className="text-xs opacity-60">{bp.width}px</span>
          </Button>
        ))}
      </div>

      {/* Preview area — measured container */}
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-auto bg-muted/30"
      >
        {/* Outer shell: reflects the scaled dimensions so scrolling works correctly */}
        <div
          style={{
            width: viewportW * scale,
            height: viewportH * scale,
            flexShrink: 0,
          }}
        >
          {/* Scaled stage: renders the iframe at true viewport size, then scales down */}
          <div
            className="overflow-hidden"
            style={{
              width: viewportW,
              height: viewportH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-scripts allow-same-origin"
              className="h-full w-full border-0"
              title="Design preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
