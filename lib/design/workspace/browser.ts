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

/**
 * CDP `protocolTimeout` applied at launch. Defaults to 180_000 (3 min) in
 * Puppeteer 24 — which the `Runtime.callFunctionOn` bug hunt proved is too
 * tight for our capture paths. Preview HTML blobs routinely reach 1–2 MB, the
 * esbuild-bundled preview JS compiles + runs Tailwind at module boot, and
 * `waitForPageReady` polls for `data-preview-ready="true"` via a single
 * awaited `Runtime.callFunctionOn` promise — under the default ceiling, large
 * documents timed out at the CDP layer with `Runtime.callFunctionOn timed
 * out`, which surfaced at the tool boundary as `Waiting failed (cause: …)`
 * after we added `error.cause` propagation.
 *
 * Matching `PUPPETEER_TIMEOUT_MS` (10 min) means every single CDP call in the
 * capture pipeline gets the same ceiling as the outer `Promise.race` guard —
 * we can never hit the protocol timeout before the logical timeout, so
 * failure modes collapse from two competing races into one.
 */
const PROTOCOL_TIMEOUT_MS = 10 * 60_000; // 10 min — matches PUPPETEER_TIMEOUT_MS in export.ts

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
    // Raise the CDP command ceiling so `Runtime.callFunctionOn` (driving
    // `waitForFunction` + `evaluate`) does not abort before our 8-minute
    // preview-ready wait completes on large documents. Default is 180_000.
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
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
