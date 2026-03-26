/**
 * Chromium Session Manager
 *
 * Manages isolated Playwright BrowserContexts per agent session.
 * Uses a single shared browser process with context-level isolation
 * (cookies, localStorage, service workers are fully sandboxed).
 *
 * Lifecycle:
 *  1. getOrCreateSession(sessionId) → creates a BrowserContext
 *  2. Agent performs actions via the chromiumWorkspace tool
 *  3. closeSession(sessionId) → closes the context + records history
 *  4. Idle reaper auto-closes sessions after IDLE_TIMEOUT_MS
 *
 * Singleton: stored on globalThis to survive Next.js hot reloads.
 */

import type { Browser, BrowserContext, Page } from "playwright-core";
import { join } from "path";
import { homedir, platform } from "os";
import { startScreencast, stopScreencast } from "./screencast";
import { cleanupInputSession, cleanupAllInputSessions } from "./input-dispatcher";

// ─── Timeout helpers ──────────────────────────────────────────────────────────

/** Timeout for graceful browser/context close operations */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Race a promise against a timeout. Returns the promise result or
 * rejects with a timeout error. The original promise is NOT cancelled —
 * this is used to avoid blocking forever on degraded browsers.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrowserSession {
  sessionId: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastAccessedAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Close idle sessions after 10 minutes */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Reaper sweep interval */
const REAPER_INTERVAL_MS = 60 * 1000;

// ─── Global singleton state (survives HMR) ────────────────────────────────────

interface ChromiumManagerState {
  browser: Browser | null;
  persistentContext: BrowserContext | null;  // For user-chrome mode
  browserMode: "standalone" | "user-chrome" | null;
  sessions: Map<string, BrowserSession>;
  reaperInterval: ReturnType<typeof setInterval> | null;
  launching: Promise<void> | null;
}

const GLOBAL_KEY = "__selene_chromium_manager__" as const;

function getState(): ChromiumManagerState {
  const g = globalThis as unknown as Record<string, ChromiumManagerState>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      browser: null,
      persistentContext: null,
      browserMode: null,
      sessions: new Map(),
      reaperInterval: null,
      launching: null,
    };
  }
  return g[GLOBAL_KEY];
}

// ─── Chrome profile helpers ───────────────────────────────────────────────────

/**
 * Returns the OS-specific default Chrome user data directory.
 *
 * Only returns the most common Google Chrome path per platform. For other
 * Chromium-based browsers (Brave, Edge, Chromium, Snap/Flatpak installs),
 * users should specify their profile path via Settings → Preferences →
 * "Chrome User Profile Path".
 */
function getDefaultChromeProfilePath(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Google", "Chrome");
    case "win32":
      return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "Google", "Chrome", "User Data");
    default: // linux
      return join(home, ".config", "google-chrome");
  }
}

/**
 * Reads the current browser mode setting. Lazy-loads settings to avoid
 * circular imports at module scope.
 */
function getBrowserSettings(): { mode: "standalone" | "user-chrome"; profilePath: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadSettings } = require("@/lib/settings/settings-manager");
    const settings = loadSettings();
    return {
      mode: settings.chromiumBrowserMode || "standalone",
      profilePath: settings.chromiumUserProfilePath || "",
    };
  } catch {
    return { mode: "standalone", profilePath: "" };
  }
}

// ─── Browser lifecycle ────────────────────────────────────────────────────────

/**
 * Ensure the shared Chromium browser instance is running.
 * Uses a launch lock to prevent concurrent startups.
 *
 * In "user-chrome" mode, launches with launchPersistentContext() to inherit
 * the user's real Chrome profile (cookies, extensions, fingerprint).
 *
 * After this resolves, callers should read from state.browser (standalone)
 * or state.persistentContext (user-chrome) directly.
 */
async function ensureBrowser(): Promise<void> {
  const state = getState();
  const { mode } = getBrowserSettings();

  // If mode changed while a browser is running, shut down and restart
  const isRunning = state.browser?.isConnected() || state.persistentContext;
  if (state.browserMode && state.browserMode !== mode && isRunning) {
    console.log(`[ChromiumManager] Browser mode changed from ${state.browserMode} to ${mode} — restarting`);
    await shutdownBrowser();
  }

  // Already connected — but verify the browser is actually functional.
  // isConnected() can return true even when the browser is in a degraded
  // state (renderer crash, GPU crash). Test with a lightweight operation.
  if (state.browser?.isConnected() || state.persistentContext) {
    try {
      if (state.browser) {
        // Standalone: test that the browser can allocate a new context.
        // IMPORTANT: capture the probe promise separately so we can close the
        // context even if the timeout fires first (prevents BrowserContext leak).
        const probePromise = state.browser.newContext();
        try {
          const probe = await withTimeout(probePromise, 5000, "browser health check");
          await probe.close();
        } catch (err) {
          // Close the probe if it eventually resolved (timeout raced ahead)
          probePromise.then((ctx) => ctx.close()).catch(() => {});
          throw err;
        }
      } else if (state.persistentContext) {
        // User-chrome: test that the persistent context can create a page.
        const probePromise = state.persistentContext.newPage();
        try {
          const probe = await withTimeout(probePromise, 5000, "browser health check");
          await probe.close();
        } catch (err) {
          probePromise.then((p) => p.close()).catch(() => {});
          throw err;
        }
      }
      return;
    } catch (err) {
      console.warn("[ChromiumManager] Browser health check failed — forcing restart:", err);
      await shutdownBrowser();
      // Fall through to re-launch
    }
  }

  // Another caller is already launching — wait for it
  if (state.launching) {
    await state.launching;
    return;
  }

  state.launching = (async () => {
    try {
      // Dynamic import — playwright-core is optional at build time
      const { chromium } = await import("playwright-core");

      if (mode === "user-chrome") {
        await launchUserChrome(chromium, state);
      } else {
        await launchStandalone(chromium, state);
      }
    } finally {
      state.launching = null;
    }
  })();

  await state.launching;
}

/**
 * Launch in standalone mode — headless, isolated contexts, Selene UA.
 * Current default behavior.
 */
async function launchStandalone(
  chromium: typeof import("playwright-core").chromium,
  state: ChromiumManagerState,
): Promise<void> {
  const launchArgs = [
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-sandbox",
    "--disable-setuid-sandbox",
  ];

  let browser: Browser;

  // Strategy: try system Chrome first (zero download), then fall back
  // to Playwright's bundled Chromium (only if already installed).
  const strategies: Array<{ label: string; opts: Parameters<typeof chromium.launch>[0] }> = [
    {
      label: "system Chrome",
      opts: { channel: "chrome", headless: true, args: launchArgs },
    },
    {
      label: "system Chromium",
      opts: { channel: "chromium", headless: true, args: launchArgs },
    },
    {
      label: "Playwright bundled Chromium",
      opts: { headless: true, args: launchArgs },
    },
  ];

  let lastError: Error | null = null;
  browser = null as unknown as Browser;

  for (const { label, opts } of strategies) {
    try {
      browser = await chromium.launch(opts);
      console.log(`[ChromiumManager] Launched using ${label} (standalone mode)`);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log(`[ChromiumManager] ${label} not available: ${lastError.message.split("\n")[0]}`);
    }
  }

  if (!browser) {
    throw new Error(
      `No Chrome/Chromium browser found. Install Google Chrome or run: npx playwright install chromium\n` +
      `Last error: ${lastError?.message ?? "unknown"}`
    );
  }

  browser.on("disconnected", () => {
    const s = getState();
    // Stop all screencasts synchronously (best-effort) — CDP sessions are dead
    // but we must clear the screencast state so isScreencastActive() returns false
    // and new sessions can start fresh screencasts.
    import("./screencast").then(({ stopAllScreencasts }) => stopAllScreencasts()).catch(() => {});
    cleanupAllInputSessions();
    s.browser = null;
    s.persistentContext = null;
    s.browserMode = null;
    s.sessions.clear();
    stopReaper();
    console.warn("[ChromiumManager] Browser disconnected — all sessions invalidated");
  });

  state.browser = browser;
  state.persistentContext = null;
  state.browserMode = "standalone";
  startReaper();
}

/**
 * Launch in user-chrome mode — uses launchPersistentContext() with the
 * user's real Chrome profile directory. Inherits cookies, extensions,
 * fonts, WebGL fingerprint.
 *
 * Runs non-headless so the real rendering pipeline is used (better
 * anti-detection). The Electron screencast viewer still works via CDP.
 *
 * Note: launchPersistentContext() returns a BrowserContext directly — there
 * is no separate Browser object. The persistent context IS the top-level
 * resource, so state.browser remains null in this mode.
 *
 * Throws a clear error if Chrome's profile lock is held (user has Chrome open).
 */
async function launchUserChrome(
  chromium: typeof import("playwright-core").chromium,
  state: ChromiumManagerState,
): Promise<void> {
  const { profilePath } = getBrowserSettings();
  const resolvedPath = profilePath || getDefaultChromeProfilePath();

  console.log(`[ChromiumManager] Launching with user Chrome profile: ${resolvedPath}`);
  console.log("[ChromiumManager] User Chrome mode: a visible Chrome window will open. This is expected.");

  try {
    const context = await chromium.launchPersistentContext(resolvedPath, {
      channel: "chrome",
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
      ],
      viewport: { width: 1280, height: 720 },
      // No custom UA — use Chrome's real one for anti-detection
      ignoreHTTPSErrors: true,
    });

    // Persistent context has no separate Browser object — context.browser()
    // returns null. Track the context directly as the top-level resource.
    context.on("close", () => {
      const s = getState();
      import("./screencast").then(({ stopAllScreencasts }) => stopAllScreencasts()).catch(() => {});
      cleanupAllInputSessions();
      s.browser = null;
      s.persistentContext = null;
      s.browserMode = null;
      s.sessions.clear();
      stopReaper();
      console.warn("[ChromiumManager] Persistent context closed — all sessions invalidated");
    });

    state.browser = null; // No browser object for persistent contexts
    state.persistentContext = context;
    state.browserMode = "user-chrome";
    startReaper();

    console.log("[ChromiumManager] Launched using user Chrome profile (user-chrome mode)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Detect Chrome profile lock conflict
    if (msg.includes("lock") || msg.includes("already running") || msg.includes("SingletonLock")) {
      throw new Error(
        "Cannot launch with your Chrome profile because Chrome is currently open. " +
        "Close all Chrome windows and try again, or switch to Standalone mode in Settings → Preferences."
      );
    }

    throw new Error(
      `Failed to launch with user Chrome profile at "${resolvedPath}": ${msg}\n` +
      "Make sure Google Chrome is installed and the profile path is correct."
    );
  }
}

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Get an existing session or create a new isolated BrowserContext.
 *
 * In standalone mode: each session gets its own isolated BrowserContext.
 * In user-chrome mode: sessions share the persistent context (same cookies,
 * extensions, fingerprint) but each gets a separate page/tab.
 */
export async function getOrCreateSession(sessionId: string): Promise<BrowserSession> {
  const state = getState();
  const existing = state.sessions.get(sessionId);

  if (existing) {
    // Verify the page is still alive — pages can crash silently during heavy
    // JS execution (e.g., audio buffers, shadow DOM manipulation) and leave
    // stale session objects in the map.
    if (existing.page.isClosed()) {
      console.warn(`[ChromiumManager] Session ${sessionId} has a closed page — cleaning up and recreating`);
      await stopScreencast(sessionId);
      cleanupInputSession(sessionId);
      state.sessions.delete(sessionId);

      // In user-chrome mode the persistent context is shared across sessions, so
      // only tear down isolated standalone contexts here.
      const isSharedPersistentContext =
        state.persistentContext != null && existing.context === state.persistentContext;
      if (!isSharedPersistentContext) {
        try {
          await withTimeout(
            existing.context.close(),
            CLOSE_TIMEOUT_MS,
            `closing stale context for session ${sessionId}`
          );
        } catch {
          // Ignore — context may already be dead
        }
      }
    } else {
      existing.lastAccessedAt = Date.now();
      return existing;
    }
  }

  await ensureBrowser();

  let context: BrowserContext;
  let page: Page;

  try {
    if (state.browserMode === "user-chrome" && state.persistentContext) {
      // User-chrome mode: reuse the persistent context, create a new page/tab
      context = state.persistentContext;
      page = await context.newPage();
    } else {
      // Standalone mode: create an isolated context per session
      if (!state.browser) {
        throw new Error("[ChromiumManager] Browser not available after ensureBrowser() — this should not happen");
      }
      const browser = state.browser;
      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Selene/1.0",
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
      });
      page = await context.newPage();
    }
  } catch (err) {
    // Context/page creation failed — the browser is likely in a degraded state.
    // Force a full restart and retry once.
    console.warn(`[ChromiumManager] Failed to create session context — restarting browser:`, err);
    await shutdownBrowser();
    await ensureBrowser();

    if (state.browserMode === "user-chrome" && state.persistentContext) {
      context = state.persistentContext;
      page = await context.newPage();
    } else if (state.browser) {
      context = await state.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Selene/1.0",
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
      });
      page = await context.newPage();
    } else {
      throw new Error("[ChromiumManager] Browser restart failed — cannot create session");
    }
  }

  const now = Date.now();

  const session: BrowserSession = {
    sessionId,
    context,
    page,
    createdAt: now,
    lastAccessedAt: now,
  };

  state.sessions.set(sessionId, session);
  console.log(`[ChromiumManager] Session created: ${sessionId} (${state.browserMode} mode, active: ${state.sessions.size})`);

  // Start live screencast for the backdrop
  startScreencast(sessionId, page).catch((err) => {
    console.warn(`[ChromiumManager] Screencast auto-start failed:`, err);
  });

  return session;
}

/**
 * Get a session without creating one. Returns null if not found.
 */
export function getSession(sessionId: string): BrowserSession | null {
  const state = getState();
  const session = state.sessions.get(sessionId) ?? null;
  if (session) session.lastAccessedAt = Date.now();
  return session;
}

/**
 * Close and clean up a specific session.
 *
 * In standalone mode: closes the entire BrowserContext.
 * In user-chrome mode: closes only the page (the persistent context stays alive).
 */
export async function closeSession(sessionId: string): Promise<void> {
  const state = getState();
  const session = state.sessions.get(sessionId);
  if (!session) return;

  // Stop screencast before closing
  await stopScreencast(sessionId);

  // Clean up CDP input dispatch session
  cleanupInputSession(sessionId);

  state.sessions.delete(sessionId);

  try {
    if (state.browserMode === "user-chrome" && state.persistentContext) {
      // In user-chrome mode, only close the page — the shared context stays alive.
      await withTimeout(session.page.close(), CLOSE_TIMEOUT_MS, `closing page for session ${sessionId}`);
    } else {
      // In standalone mode, close the entire isolated context.
      await withTimeout(session.context.close(), CLOSE_TIMEOUT_MS, `closing context for session ${sessionId}`);
    }
  } catch (err) {
    // Context/page may already be closed or a degraded browser may stop responding.
    // We still drop the session so a fresh one can be created immediately.
    console.warn(`[ChromiumManager] Error closing session ${sessionId}:`, err);
  }

  console.log(`[ChromiumManager] Session closed: ${sessionId} (active: ${state.sessions.size})`);

  // Don't auto-shutdown when last session closes — a concurrent getOrCreateSession()
  // may be past ensureBrowser() and about to use the browser (TOCTOU race).
  // The reaper will clean up idle browsers, and shutdownAll() handles explicit teardown.
}

/**
 * Close all sessions and shut down the browser.
 */
export async function shutdownAll(): Promise<void> {
  const state = getState();

  // Stop all screencasts first
  const { stopAllScreencasts } = await import("./screencast");
  await stopAllScreencasts();

  // In user-chrome mode, all sessions share the same persistent context — don't
  // close it N times. Just close individual pages, then shutdownBrowser() will
  // close the persistent context once.
  if (state.browserMode === "user-chrome") {
    const closePromises = Array.from(state.sessions.values()).map(async (session) => {
      try {
        await withTimeout(session.page.close(), CLOSE_TIMEOUT_MS, `closing page for session ${session.sessionId}`);
      } catch {
        // Ignore — page may already be closed or the browser may be degraded
      }
    });
    await Promise.allSettled(closePromises);
  } else {
    // Standalone mode: each session has its own isolated context
    const closePromises = Array.from(state.sessions.values()).map(async (session) => {
      try {
        await withTimeout(session.context.close(), CLOSE_TIMEOUT_MS, `closing context for session ${session.sessionId}`);
      } catch {
        // Ignore — browser may already be gone or the close may have stalled
      }
    });
    await Promise.allSettled(closePromises);
  }
  state.sessions.clear();

  await shutdownBrowser();
}

/**
 * Get the count of active sessions (for diagnostics).
 */
export function getActiveSessionCount(): number {
  return getState().sessions.size;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function shutdownBrowser(): Promise<void> {
  const state = getState();
  stopReaper();

  // Clear sessions first — their page/context refs are about to become invalid
  state.sessions.clear();

  // In user-chrome mode, close the persistent context first (closes browser too)
  if (state.persistentContext) {
    try {
      await withTimeout(
        state.persistentContext.close(),
        CLOSE_TIMEOUT_MS,
        "closing persistent browser context"
      );
    } catch {
      // Ignore — the browser may already be gone or the close may have stalled
    }
    state.persistentContext = null;
  }

  if (state.browser) {
    try {
      await withTimeout(state.browser.close(), CLOSE_TIMEOUT_MS, "closing browser");
    } catch {
      // Ignore — may already be closed by persistent context teardown or the close may have stalled
    }
    state.browser = null;
  }

  state.browserMode = null;
  console.log("[ChromiumManager] Browser shut down");
}

function startReaper(): void {
  const state = getState();
  if (state.reaperInterval) return;

  state.reaperInterval = setInterval(async () => {
    const now = Date.now();
    const toClose: string[] = [];

    for (const [id, session] of getState().sessions) {
      if (now - session.lastAccessedAt > IDLE_TIMEOUT_MS) {
        toClose.push(id);
      }
    }

    for (const id of toClose) {
      console.log(`[ChromiumManager] Reaping idle session: ${id}`);
      await closeSession(id);
    }
  }, REAPER_INTERVAL_MS);

  // Don't prevent Node from exiting
  if (state.reaperInterval && typeof state.reaperInterval === "object" && "unref" in state.reaperInterval) {
    state.reaperInterval.unref();
  }
}

function stopReaper(): void {
  const state = getState();
  if (state.reaperInterval) {
    clearInterval(state.reaperInterval);
    state.reaperInterval = null;
  }
}
