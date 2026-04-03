/**
 * Browser Input Dispatcher
 *
 * Sends mouse, keyboard, and scroll events to a Playwright page via CDP.
 * Used by the interact API to forward user interactions from the screencast
 * viewer to the actual browser page.
 *
 * This is the same mechanism Chrome DevTools uses for remote device input.
 */

import type { Page, CDPSession } from "playwright-core";

// ─── CDP Session Cache ─────────────────────────────────────────────────────────

const GLOBAL_KEY = "__selene_input_cdp_sessions__" as const;
const PENDING_KEY = "__selene_input_cdp_pending__" as const;
const SESSION_GEN_KEY = "__selene_input_cdp_session_generations__" as const;
const GLOBAL_GEN_KEY = "__selene_input_cdp_global_generation__" as const;

function getCdpCache(): Map<string, CDPSession> {
  const g = globalThis as unknown as Record<string, Map<string, CDPSession>>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map();
  }
  return g[GLOBAL_KEY];
}

function getPendingCreations(): Map<string, Promise<CDPSession>> {
  const g = globalThis as unknown as Record<string, Map<string, Promise<CDPSession>>>;
  if (!g[PENDING_KEY]) {
    g[PENDING_KEY] = new Map();
  }
  return g[PENDING_KEY];
}

function getSessionGenerations(): Map<string, number> {
  const g = globalThis as unknown as Record<string, Map<string, number>>;
  if (!g[SESSION_GEN_KEY]) {
    g[SESSION_GEN_KEY] = new Map();
  }
  return g[SESSION_GEN_KEY];
}

function getGlobalGeneration(): number {
  const g = globalThis as unknown as Record<string, number>;
  if (typeof g[GLOBAL_GEN_KEY] !== "number") {
    g[GLOBAL_GEN_KEY] = 0;
  }
  return g[GLOBAL_GEN_KEY];
}

function bumpGlobalGeneration(): void {
  const g = globalThis as unknown as Record<string, number>;
  g[GLOBAL_GEN_KEY] = getGlobalGeneration() + 1;
}

function getSessionGeneration(sessionId: string): number {
  return getSessionGenerations().get(sessionId) ?? 0;
}

function bumpSessionGeneration(sessionId: string): void {
  const generations = getSessionGenerations();
  generations.set(sessionId, getSessionGeneration(sessionId) + 1);
}

/**
 * Get or create a CDP session for input dispatch.
 * Caches per sessionId to avoid creating multiple CDP sessions for the same page.
 * Uses a pending promise map to prevent race conditions when concurrent requests
 * both attempt to create a new CDP session for the same sessionId.
 */
async function getCdpSession(sessionId: string, page: Page): Promise<CDPSession> {
  const cache = getCdpCache();
  const existing = cache.get(sessionId);
  if (existing) {
    try {
      // Verify the session is still alive
      await existing.send("Runtime.evaluate", { expression: "1" });
      return existing;
    } catch {
      cache.delete(sessionId);
    }
  }

  // Check if another caller is already creating this session
  const pending = getPendingCreations();
  const inflight = pending.get(sessionId);
  if (inflight) return inflight;

  const sessionGeneration = getSessionGeneration(sessionId);
  const globalGeneration = getGlobalGeneration();

  const promise = (async () => {
    try {
      const cdp = await page.context().newCDPSession(page);

      // Teardown may have happened while this CDP session was being created.
      // If the generation changed, detach the stale CDP instead of resurrecting it.
      if (
        sessionGeneration !== getSessionGeneration(sessionId) ||
        globalGeneration !== getGlobalGeneration()
      ) {
        cdp.detach().catch(() => {});
        throw new Error(`CDP session became stale during creation for ${sessionId}`);
      }

      cache.set(sessionId, cdp);
      return cdp;
    } finally {
      pending.delete(sessionId);
    }
  })();

  pending.set(sessionId, promise);
  return promise;
}

/**
 * Clean up cached CDP session when a browser session closes.
 */
export function cleanupInputSession(sessionId: string): void {
  const cache = getCdpCache();
  const pending = getPendingCreations();
  bumpSessionGeneration(sessionId);

  const cdp = cache.get(sessionId);
  if (cdp) {
    cdp.detach().catch(() => {});
    cache.delete(sessionId);
  }

  pending.delete(sessionId);
}

/**
 * Clean up all cached CDP sessions. Used when the underlying browser/context
 * dies and every cached session becomes invalid at once.
 */
export function cleanupAllInputSessions(): void {
  const cache = getCdpCache();
  bumpGlobalGeneration();

  for (const cdp of cache.values()) {
    cdp.detach().catch(() => {});
  }

  cache.clear();
  getPendingCreations().clear();
  getSessionGenerations().clear();
}

// ─── Mouse Events ──────────────────────────────────────────────────────────────

/**
 * Dispatch a mouse click at (x, y) in viewport coordinates.
 * Sends mousePressed + mouseReleased for a complete click.
 */
export async function dispatchClick(
  sessionId: string,
  page: Page,
  x: number,
  y: number,
  options?: { button?: "left" | "right" | "middle"; clickCount?: number }
): Promise<void> {
  const cdp = await getCdpSession(sessionId, page);
  const button = options?.button ?? "left";
  const clickCount = options?.clickCount ?? 1;

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    clickCount,
  });

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount,
  });
}

/**
 * Dispatch a mouse move to (x, y) in viewport coordinates.
 */
async function dispatchMouseMove(
  sessionId: string,
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const cdp = await getCdpSession(sessionId, page);

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
}

// ─── Keyboard Events ───────────────────────────────────────────────────────────

/**
 * Type a string of text using CDP Input.insertText.
 * Uses a single CDP call instead of 2N keyDown/keyUp events per character,
 * and correctly handles multi-byte input (emoji, CJK, accented characters).
 */
export async function dispatchType(
  sessionId: string,
  page: Page,
  text: string,
): Promise<void> {
  const cdp = await getCdpSession(sessionId, page);

  // Use Input.insertText for reliable multi-byte character support
  await cdp.send("Input.insertText", { text });
}

/**
 * Dispatch a single key press (for special keys like Enter, Tab, Escape, etc.).
 */
export async function dispatchKeyPress(
  sessionId: string,
  page: Page,
  key: string,
  options?: { modifiers?: number }
): Promise<void> {
  const cdp = await getCdpSession(sessionId, page);
  const modifiers = options?.modifiers ?? 0;

  // Map common key names to key codes
  const keyCodeMap: Record<string, { keyCode: number; code: string }> = {
    Enter: { keyCode: 13, code: "Enter" },
    Tab: { keyCode: 9, code: "Tab" },
    Escape: { keyCode: 27, code: "Escape" },
    Backspace: { keyCode: 8, code: "Backspace" },
    Delete: { keyCode: 46, code: "Delete" },
    ArrowUp: { keyCode: 38, code: "ArrowUp" },
    ArrowDown: { keyCode: 40, code: "ArrowDown" },
    ArrowLeft: { keyCode: 37, code: "ArrowLeft" },
    ArrowRight: { keyCode: 39, code: "ArrowRight" },
    Home: { keyCode: 36, code: "Home" },
    End: { keyCode: 35, code: "End" },
    PageUp: { keyCode: 33, code: "PageUp" },
    PageDown: { keyCode: 34, code: "PageDown" },
    Space: { keyCode: 32, code: "Space" },
  };

  const mapped = keyCodeMap[key];

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: mapped?.code ?? key,
    windowsVirtualKeyCode: mapped?.keyCode ?? 0,
    modifiers,
  });

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: mapped?.code ?? key,
    windowsVirtualKeyCode: mapped?.keyCode ?? 0,
    modifiers,
  });
}

// ─── Scroll Events ─────────────────────────────────────────────────────────────

/**
 * Dispatch a scroll event at (x, y) with delta.
 */
export async function dispatchScroll(
  sessionId: string,
  page: Page,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const cdp = await getCdpSession(sessionId, page);

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX,
    deltaY,
  });
}
