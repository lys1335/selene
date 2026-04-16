"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDesignWorkspaceStore, DESIGN_BREAKPOINTS } from "@/lib/design/workspace";
import { Button } from "@/components/ui/button";
import { Monitor, Tablet, Smartphone, Crosshair, Maximize, Sun, Moon, SunMoon } from "lucide-react";
import type { DesignPreviewTheme } from "@/lib/design/workspace/types";
import type { InspectedElement } from "@/lib/design/workspace/types";

const BREAKPOINT_ICONS: Record<string, ReactNode> = {
  responsive: <Maximize className="h-4 w-4" />,
  mobile: <Smartphone className="h-4 w-4" />,
  tablet: <Tablet className="h-4 w-4" />,
  desktop: <Monitor className="h-4 w-4" />,
};

const PREVIEW_THEME_OPTIONS: { value: DesignPreviewTheme; icon: ReactNode; label: string }[] = [
  { value: "light", icon: <Sun className="h-4 w-4" />, label: "Light" },
  { value: "dark", icon: <Moon className="h-4 w-4" />, label: "Dark" },
  { value: "system", icon: <SunMoon className="h-4 w-4" />, label: "System" },
];

/**
 * Apply the selected preview theme to compiled HTML.
 *
 * The compiler outputs `<html lang="en" class="dark">` by default. This
 * function patches the `<html>` tag so that:
 * - "light" removes the `dark` class
 * - "dark" ensures the `dark` class is present
 * - "system" removes the static class and injects a tiny script that reacts
 *   to `prefers-color-scheme` at runtime
 */
function applyPreviewTheme(html: string, theme: DesignPreviewTheme): string {
  if (theme === "light") {
    // Remove the dark class from <html>
    return html.replace(/<html([^>]*)\s+class="dark"/, "<html$1");
  }
  if (theme === "dark") {
    // Ensure dark class is present (it already is by default, but handle edge cases)
    if (/<html[^>]*class="dark"/.test(html)) return html;
    return html.replace(/<html([^>]*)>/, '<html$1 class="dark">');
  }
  // "system" — remove static class, inject media-query script
  const withoutDark = html.replace(/<html([^>]*)\s+class="dark"/, "<html$1");
  const systemScript = `<script>(function(){var h=document.documentElement;function u(){h.classList.toggle('dark',window.matchMedia('(prefers-color-scheme:dark)').matches)}u();window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',u)})()</script>`;
  if (withoutDark.includes("</head>")) {
    return withoutDark.replace("</head>", systemScript + "</head>");
  }
  return withoutDark.replace(/<body/, systemScript + "<body");
}

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
// Inspector script — injected into the iframe when inspector mode is active.
// Self-contained, no external deps. Communicates via postMessage.
// ---------------------------------------------------------------------------
const INSPECTOR_SCRIPT = `
(function() {
  if (window.__seleneInspector) return;
  window.__seleneInspector = true;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Overlay canvas
  var overlay = document.createElement('div');
  overlay.id = '__selene-inspector-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;';
  document.documentElement.appendChild(overlay);

  // Tooltip
  var tooltip = document.createElement('div');
  tooltip.id = '__selene-inspector-tooltip';
  tooltip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(0,0,0,0.85);color:#fff;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 8px;border-radius:4px;white-space:nowrap;display:none;max-width:360px;overflow:hidden;text-overflow:ellipsis;';
  document.documentElement.appendChild(tooltip);

  // Box-model highlight elements
  var marginBox = document.createElement('div');
  marginBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(246,178,107,0.3);';
  var paddingBox = document.createElement('div');
  paddingBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(147,196,125,0.3);';
  var contentBox = document.createElement('div');
  contentBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(111,168,220,0.3);';
  document.documentElement.appendChild(marginBox);
  document.documentElement.appendChild(paddingBox);
  document.documentElement.appendChild(contentBox);

  var hoveredEl = null;

  function getCssSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var current = el;
    while (current && current !== document.documentElement) {
      var tag = current.tagName.toLowerCase();
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(current) + 1;
          tag += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(tag);
      current = parent;
    }
    return parts.join(' > ');
  }

  function parseNum(v) { return parseFloat(v) || 0; }

  function highlight(el) {
    if (!el || el === document.documentElement || el === document.body) {
      hideHighlight();
      return;
    }
    var rect = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var mt = parseNum(cs.marginTop), mr = parseNum(cs.marginRight), mb = parseNum(cs.marginBottom), ml = parseNum(cs.marginLeft);
    var pt = parseNum(cs.paddingTop), pr = parseNum(cs.paddingRight), pb = parseNum(cs.paddingBottom), pl = parseNum(cs.paddingLeft);

    // Margin box
    marginBox.style.top = (rect.top - mt) + 'px';
    marginBox.style.left = (rect.left - ml) + 'px';
    marginBox.style.width = (rect.width + ml + mr) + 'px';
    marginBox.style.height = (rect.height + mt + mb) + 'px';
    marginBox.style.display = 'block';

    // Padding box (same as border box here)
    paddingBox.style.top = rect.top + 'px';
    paddingBox.style.left = rect.left + 'px';
    paddingBox.style.width = rect.width + 'px';
    paddingBox.style.height = rect.height + 'px';
    paddingBox.style.display = 'block';

    // Content box
    contentBox.style.top = (rect.top + pt) + 'px';
    contentBox.style.left = (rect.left + pl) + 'px';
    contentBox.style.width = (rect.width - pl - pr) + 'px';
    contentBox.style.height = (rect.height - pt - pb) + 'px';
    contentBox.style.display = 'block';
  }

  function hideHighlight() {
    marginBox.style.display = 'none';
    paddingBox.style.display = 'none';
    contentBox.style.display = 'none';
    tooltip.style.display = 'none';
  }

  function showTooltip(el, x, y) {
    var rect = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var tag = el.tagName.toLowerCase();
    var cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
    var idStr = el.id ? '#' + el.id : '';
    var dims = Math.round(rect.width) + ' x ' + Math.round(rect.height);
    tooltip.textContent = tag + idStr + cls + '  ' + dims;
    tooltip.style.display = 'block';

    // Position: prefer below-right of cursor, flip if needed
    var tx = x + 12;
    var ty = y + 12;
    if (tx + tooltip.offsetWidth > window.innerWidth) tx = x - tooltip.offsetWidth - 4;
    if (ty + tooltip.offsetHeight > window.innerHeight) ty = y - tooltip.offsetHeight - 4;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  }

  function buildPayload(el) {
    var rect = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var text = (el.textContent || '').trim();
    if (text.length > 120) text = text.slice(0, 120) + '...';
    return {
      type: 'selene-inspector-select',
      element: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || '',
        className: (typeof el.className === 'string') ? el.className : '',
        textContent: text,
        selector: getCssSelector(el),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: {
          width: cs.width,
          height: cs.height,
          padding: cs.padding,
          margin: cs.margin,
          display: cs.display,
          position: cs.position,
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          fontSize: cs.fontSize,
          fontFamily: cs.fontFamily
        }
      }
    };
  }

  function isInspectorElement(el) {
    return el === overlay || el === tooltip || el === marginBox || el === paddingBox || el === contentBox;
  }

  function onMouseMove(e) {
    var target = e.target;
    if (!target || isInspectorElement(target)) return;
    // Skip SVG internal elements — highlight the nearest SVGSVGElement
    if (target instanceof SVGElement && !(target instanceof SVGSVGElement)) {
      target = target.closest('svg') || target;
    }
    hoveredEl = target;
    highlight(target);
    showTooltip(target, e.clientX, e.clientY);
  }

  // --- Persistent selection overlays ---
  var selectedOverlays = [];

  function createSelectionOverlay(el) {
    var rect = el.getBoundingClientRect();
    var box = document.createElement('div');
    box.className = '__selene-selection-overlay';
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483644;border:2px solid #3b82f6;background:rgba(59,130,246,0.08);border-radius:2px;';
    box.style.top = rect.top + 'px';
    box.style.left = rect.left + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    box.dataset.selector = getCssSelector(el);
    document.documentElement.appendChild(box);
    return box;
  }

  function refreshSelectionOverlays() {
    selectedOverlays.forEach(function(entry) {
      if (!entry.el || !entry.el.isConnected) { entry.box.remove(); return; }
      var rect = entry.el.getBoundingClientRect();
      entry.box.style.top = rect.top + 'px';
      entry.box.style.left = rect.left + 'px';
      entry.box.style.width = rect.width + 'px';
      entry.box.style.height = rect.height + 'px';
    });
  }

  function addSelection(el) {
    var selector = getCssSelector(el);
    var exists = selectedOverlays.some(function(entry) { return entry.selector === selector; });
    if (exists) return;
    if (selectedOverlays.length >= 8) return; // MAX_INSPECT_SELECTIONS
    var box = createSelectionOverlay(el);
    selectedOverlays.push({ el: el, box: box, selector: selector });
  }

  function removeSelection(selector) {
    selectedOverlays = selectedOverlays.filter(function(entry) {
      if (entry.selector === selector) { entry.box.remove(); return false; }
      return true;
    });
  }

  function clearSelections() {
    selectedOverlays.forEach(function(entry) { entry.box.remove(); });
    selectedOverlays = [];
  }

  function isSelected(el) {
    var selector = getCssSelector(el);
    return selectedOverlays.some(function(entry) { return entry.selector === selector; });
  }

  function onClick(e) {
    if (!hoveredEl || isInspectorElement(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
    var payload = buildPayload(hoveredEl);
    payload.multiSelect = isMulti;

    if (isMulti) {
      // Toggle selection
      var selector = getCssSelector(hoveredEl);
      if (isSelected(hoveredEl)) {
        removeSelection(selector);
        payload.action = 'remove';
      } else {
        addSelection(hoveredEl);
        payload.action = 'add';
      }
    } else {
      // Single select — replace
      clearSelections();
      addSelection(hoveredEl);
      payload.action = 'replace';
    }

    window.parent.postMessage(payload, '*');
  }

  // Refresh overlay positions on scroll/resize
  var rafPending = false;
  function scheduleRefresh() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function() { rafPending = false; refreshSelectionOverlays(); });
  }
  window.addEventListener('scroll', scheduleRefresh, true);
  window.addEventListener('resize', scheduleRefresh);

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);

  // Listen for cleanup message from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'selene-inspector-cleanup') {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', scheduleRefresh, true);
      window.removeEventListener('resize', scheduleRefresh);
      hideHighlight();
      clearSelections();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      if (marginBox.parentNode) marginBox.parentNode.removeChild(marginBox);
      if (paddingBox.parentNode) paddingBox.parentNode.removeChild(paddingBox);
      if (contentBox.parentNode) contentBox.parentNode.removeChild(contentBox);
      window.__seleneInspector = false;
    }
  });
})();
`;

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

  // Track which component+code hash we last compiled to avoid redundant API calls.
  const lastCompiledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeComponentId) return;

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
  }, [activeComponentId, components, setPreviewHtml]);
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
  const previewTheme = useDesignWorkspaceStore((s) => s.previewTheme);
  const setPreviewTheme = useDesignWorkspaceStore((s) => s.setPreviewTheme);
  const setSelectedElement = useDesignWorkspaceStore((s) => s.setSelectedElement);
  const toggleSelectedElement = useDesignWorkspaceStore((s) => s.toggleSelectedElement);
  const setSelectedElements = useDesignWorkspaceStore((s) => s.setSelectedElements);

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

  // Apply selected theme to the preview HTML
  const themedPreviewHtml = applyPreviewTheme(previewHtml, previewTheme);

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
        <div className="mx-1 h-5 w-px bg-border" />
        {PREVIEW_THEME_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={previewTheme === option.value ? "default" : "ghost"}
            size="sm"
            aria-label={`${option.label} preview theme`}
            aria-pressed={previewTheme === option.value}
            onClick={() => setPreviewTheme(option.value)}
            className="gap-1.5"
          >
            {option.icon}
            <span>{option.label}</span>
          </Button>
        ))}
      </div>

      {/* Preview area — measured container */}
      <div
        ref={containerRef}
        className={`flex flex-1 overflow-auto bg-muted/30 ${isResponsive ? "" : "items-center justify-center"}`}
      >
        {isResponsive ? (
          /* Responsive mode: iframe fills container directly — like a real browser */
          <iframe
            ref={iframeRef}
            srcDoc={injectInspectorScript(themedPreviewHtml, inspectorEnabled)}
            sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
            className="h-full w-full border-0"
            style={{ background: "transparent" }}
            title="Design preview"
          />
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
              <iframe
                ref={iframeRef}
                srcDoc={injectInspectorScript(themedPreviewHtml, inspectorEnabled)}
                sandbox="allow-scripts allow-same-origin allow-popups allow-modals"
                className="h-full w-full border-0"
                style={{ background: "transparent" }}
                title="Design preview"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
