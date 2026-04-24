/**
 * Shared Chromium browser singleton for design-workspace capture paths.
 *
 * Reviewer blocker: `renderPngExport` + `captureScreenshot` previously called
 * `puppeteer.launch()` on every request, scaling Chromium processes linearly
 * under concurrent generate/edit/patch. This module lazily launches one
 * Chromium instance, reuses it across calls, and relaunches transparently if
 * the cached browser has disconnected or crashed.
 *
 * The cache lives on `globalThis.__seleneDesignBrowser` so Next.js HMR /
 * multiple imports in dev do not leak browser processes. The guard follows
 * the same `messageRepositoryPatched` idempotent-hook pattern used in
 * `lib/ai/streaming/injection-diagnostic-logger.ts`: module state is keyed
 * on a globalThis slot and every entry point no-ops when the slot is
 * already populated with a live handle.
 *
 * Callers acquire a fresh `Page` via `acquirePage()` and MUST close it in
 * a `finally` block. Closing the page never closes the browser — that is
 * the responsibility of `disposeBrowser()`, intended for graceful shutdown
 * and test teardown.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";

// Launch args are duplicated from export.ts's original `createBrowser` so the
// capture paths share one hardening policy. If these ever diverge, update
// both in lockstep.
const LAUNCH_ARGS = [
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
];

interface SharedBrowserCache {
  browser: Browser | null;
  launching: Promise<Browser> | null;
}

const GLOBAL_KEY = "__seleneDesignBrowser" as const;

type GlobalWithBrowserCache = typeof globalThis & {
  [GLOBAL_KEY]?: SharedBrowserCache;
};

function getCache(): SharedBrowserCache {
  const g = globalThis as GlobalWithBrowserCache;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { browser: null, launching: null };
  }
  return g[GLOBAL_KEY];
}

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
}

/**
 * Lazily launch (or reuse) the shared Chromium instance. Handles
 * crash-recovery: if the cached browser has been closed or disconnected,
 * the next call transparently relaunches. Concurrent callers share one
 * in-flight `launching` promise so we never double-launch.
 */
export async function getSharedBrowser(): Promise<Browser> {
  const cache = getCache();

  if (cache.browser && cache.browser.connected) {
    return cache.browser;
  }

  // Cached handle is dead — clear it so a crashed browser doesn't linger.
  if (cache.browser && !cache.browser.connected) {
    cache.browser = null;
  }

  if (!cache.launching) {
    cache.launching = launchBrowser()
      .then((browser) => {
        cache.browser = browser;
        // If Chromium dies later, drop the cached handle so the next
        // `getSharedBrowser()` relaunches instead of handing out a dead
        // reference.
        browser.once("disconnected", () => {
          if (cache.browser === browser) {
            cache.browser = null;
          }
        });
        return browser;
      })
      .finally(() => {
        cache.launching = null;
      });
  }

  return cache.launching;
}

/**
 * Open a fresh `Page` in the shared browser. Callers MUST close the
 * returned page in a `finally` block — this function never closes it for
 * you, and leaked pages accumulate as live Chromium tabs.
 *
 * Usage:
 * ```ts
 * const page = await acquirePage();
 * try {
 *   // ...
 * } finally {
 *   await page.close().catch(() => undefined);
 * }
 * ```
 */
export async function acquirePage(): Promise<Page> {
  const browser = await getSharedBrowser();
  return browser.newPage();
}

/**
 * Close the shared browser and clear the cache. Intended for graceful
 * shutdown and test teardown; production code should not normally call
 * this — the browser is meant to live for the lifetime of the process.
 *
 * Idempotent: safe to call when no browser has been launched.
 */
export async function disposeBrowser(): Promise<void> {
  const cache = getCache();
  const browser = cache.browser;
  cache.browser = null;
  cache.launching = null;
  if (browser && browser.connected) {
    await browser.close().catch(() => {
      // Swallow — teardown must not throw on an already-dead browser.
    });
  }
}
