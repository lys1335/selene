/**
 * Shared Inspector Script for Design Workspace
 *
 * Self-contained vanilla JavaScript injected into preview iframes.
 * Supports two modes:
 *   1. "always-active" — used when injected at render time via srcDoc (compile-tier)
 *   2. "toggle-activated" — used when injected by the inspector proxy (dev-server tier);
 *      starts inactive and activates on `selene-inspector-toggle` postMessage.
 *
 * Communication: sends `selene-inspector-select` via `window.parent.postMessage`.
 * Cleanup: responds to `selene-inspector-cleanup` message.
 */

/**
 * Returns the inspector script source code.
 *
 * @param mode
 *   - `"active"` — inspector starts immediately (compile-tier srcDoc injection)
 *   - `"toggle"` — inspector starts inactive, requires `selene-inspector-toggle` message (proxy injection)
 */
export function getInspectorScript(mode: "active" | "toggle" = "active"): string {
  const startActive = mode === "active" ? "true" : "false";
  return INSPECTOR_SCRIPT_TEMPLATE.replace("__START_ACTIVE__", startActive);
}

/**
 * The full-featured inspector script with multi-select, box-model highlighting,
 * persistent selection overlays, and toggle activation support.
 *
 * Placeholder `__START_ACTIVE__` is replaced at build time by getInspectorScript().
 */
const INSPECTOR_SCRIPT_TEMPLATE = `
(function() {
  if (window.__seleneInspector) return;
  window.__seleneInspector = true;

  var active = __START_ACTIVE__;
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
  marginBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(246,178,107,0.3);display:none;';
  var paddingBox = document.createElement('div');
  paddingBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(147,196,125,0.3);display:none;';
  var contentBox = document.createElement('div');
  contentBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(111,168,220,0.3);display:none;';
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

    marginBox.style.top = (rect.top - mt) + 'px';
    marginBox.style.left = (rect.left - ml) + 'px';
    marginBox.style.width = (rect.width + ml + mr) + 'px';
    marginBox.style.height = (rect.height + mt + mb) + 'px';
    marginBox.style.display = 'block';

    paddingBox.style.top = rect.top + 'px';
    paddingBox.style.left = rect.left + 'px';
    paddingBox.style.width = rect.width + 'px';
    paddingBox.style.height = rect.height + 'px';
    paddingBox.style.display = 'block';

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
    var tag = el.tagName.toLowerCase();
    var cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
    var idStr = el.id ? '#' + el.id : '';
    var dims = Math.round(rect.width) + ' x ' + Math.round(rect.height);
    tooltip.textContent = tag + idStr + cls + '  ' + dims;
    tooltip.style.display = 'block';

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
    if (!active) return;
    var target = e.target;
    if (!target || isInspectorElement(target)) return;
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
    if (selectedOverlays.length >= 8) return;
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
    if (!active) return;
    if (!hoveredEl || isInspectorElement(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
    var payload = buildPayload(hoveredEl);
    payload.multiSelect = isMulti;

    if (isMulti) {
      var selector = getCssSelector(hoveredEl);
      if (isSelected(hoveredEl)) {
        removeSelection(selector);
        payload.action = 'remove';
      } else {
        addSelection(hoveredEl);
        payload.action = 'add';
      }
    } else {
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

  // Listen for toggle and cleanup messages from parent
  window.addEventListener('message', function(e) {
    if (!e.data) return;

    if (e.data.type === 'selene-inspector-toggle') {
      active = !!e.data.enabled;
      if (!active) {
        hideHighlight();
        hoveredEl = null;
      }
      return;
    }

    if (e.data.type === 'selene-inspector-cleanup') {
      active = false;
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
