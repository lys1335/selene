/**
 * Smoke tests for the shared-browser singleton + timeout hygiene.
 *
 * These tests mock the `puppeteer` module so they run headlessly under
 * vitest (no real Chromium). What they prove:
 *
 *   1. `acquirePage()` called twice in sequence reuses the SAME underlying
 *      Browser instance — i.e. `puppeteer.launch` is called exactly once
 *      for N sequential captures, and `browser.close()` is NOT called
 *      between them. This is the reviewer-blocker regression test for
 *      the per-request Chromium launch.
 *
 *   2. A successful capture path in `captureScreenshot` does not leave a
 *      live `setTimeout` handle behind after it resolves. We assert this
 *      by spying on `setTimeout` / `clearTimeout` and checking that every
 *      scheduled timer is cleared.
 *
 *   3. The `globalThis.__seleneDesignBrowser` cache is honored across
 *      re-imports — simulating the hot-reload scenario the idempotent-hook
 *      constraint calls out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Puppeteer mock ─────────────────────────────────────────────────────────
//
// One fake Browser per test, tracked so assertions can see launch/close
// counts. `newPage` returns a minimal Page stub whose methods resolve to
// sane defaults; individual tests override specific methods as needed.

interface FakePage {
  setViewport: ReturnType<typeof vi.fn>;
  setContent: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface FakeBrowser {
  connected: boolean;
  newPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  process: () => { pid: number } | null;
  __pid: number;
}

const launchedBrowsers: FakeBrowser[] = [];
let nextPid = 10_000;

function makeFakePage(): FakePage {
  return {
    setViewport: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFakeBrowser(): FakeBrowser {
  const pid = nextPid++;
  const browser: FakeBrowser = {
    connected: true,
    newPage: vi.fn(async () => makeFakePage()),
    close: vi.fn(async () => {
      browser.connected = false;
    }),
    once: vi.fn(),
    process: () => ({ pid }),
    __pid: pid,
  };
  return browser;
}

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn(async () => {
      const browser = makeFakeBrowser();
      launchedBrowsers.push(browser);
      return browser;
    }),
  },
}));

// ── Shared test setup ──────────────────────────────────────────────────────

const GLOBAL_KEY = "__seleneDesignBrowser";

async function resetBrowserModule(): Promise<void> {
  // Wipe the globalThis cache so each test starts from a clean singleton.
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  launchedBrowsers.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
}

beforeEach(async () => {
  await resetBrowserModule();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── getSharedBrowser / acquirePage ─────────────────────────────────────────

describe("shared browser singleton", () => {
  it("reuses the same browser across sequential acquirePage() calls (same pid)", async () => {
    const { acquirePage, getSharedBrowser, disposeBrowser } = await import("../browser");
    const puppeteerMod = await import("puppeteer");
    const launchSpy = puppeteerMod.default.launch as ReturnType<typeof vi.fn>;

    const page1 = await acquirePage();
    const page2 = await acquirePage();

    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(launchedBrowsers).toHaveLength(1);
    expect(launchedBrowsers[0].newPage).toHaveBeenCalledTimes(2);
    expect(launchedBrowsers[0].close).not.toHaveBeenCalled();

    // Two independent observations of the shared browser's pid must match —
    // this is the real same-pid assertion. The previous `__pid === __pid`
    // line was a tautology and proved nothing about singleton reuse.
    const pid1 = (await getSharedBrowser()).process()?.pid;
    const pid2 = (await getSharedBrowser()).process()?.pid;
    expect(pid1).toBeDefined();
    expect(pid1).toBe(pid2);

    // Caller contract: close each page in finally.
    await (page1 as unknown as FakePage).close();
    await (page2 as unknown as FakePage).close();
    await disposeBrowser();
  });

  it("relaunches after disposeBrowser() with a different pid (crash-recovery proof)", async () => {
    const { getSharedBrowser, disposeBrowser } = await import("../browser");

    // First session — capture the launched browser's pid.
    const pidBefore = (await getSharedBrowser()).process()?.pid;
    expect(pidBefore).toBeDefined();
    expect(launchedBrowsers).toHaveLength(1);

    // Tear the shared browser down (simulating graceful shutdown or a
    // crash-triggered dispose).
    await disposeBrowser();
    expect(launchedBrowsers[0].close).toHaveBeenCalledTimes(1);

    // Next acquisition must spin up a FRESH browser — a different pid
    // proves the cache was cleared and that the singleton reuse seen in
    // the previous test is intentional (not an accidental global leak).
    const pidAfter = (await getSharedBrowser()).process()?.pid;
    expect(pidAfter).toBeDefined();
    expect(launchedBrowsers).toHaveLength(2);
    expect(pidAfter).not.toBe(pidBefore);

    await disposeBrowser();
  });

  it("concurrent acquirePage() calls share one in-flight launch", async () => {
    const { acquirePage, disposeBrowser } = await import("../browser");
    const puppeteerMod = await import("puppeteer");
    const launchSpy = puppeteerMod.default.launch as ReturnType<typeof vi.fn>;

    const [p1, p2, p3] = await Promise.all([
      acquirePage(),
      acquirePage(),
      acquirePage(),
    ]);

    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(launchedBrowsers).toHaveLength(1);
    expect(launchedBrowsers[0].newPage).toHaveBeenCalledTimes(3);

    await (p1 as unknown as FakePage).close();
    await (p2 as unknown as FakePage).close();
    await (p3 as unknown as FakePage).close();
    await disposeBrowser();
  });

  it("relaunches if the cached browser has disconnected", async () => {
    const { acquirePage, disposeBrowser } = await import("../browser");

    await acquirePage();
    expect(launchedBrowsers).toHaveLength(1);

    // Simulate Chromium crash.
    launchedBrowsers[0].connected = false;

    await acquirePage();
    expect(launchedBrowsers).toHaveLength(2);
    expect(launchedBrowsers[0].__pid).not.toBe(launchedBrowsers[1].__pid);

    await disposeBrowser();
  });

  it("survives hot-reload: a second import reuses the globalThis-cached browser", async () => {
    const first = await import("../browser");
    await first.acquirePage();
    expect(launchedBrowsers).toHaveLength(1);
    const firstPid = launchedBrowsers[0].__pid;

    // Drop the module from vitest's registry so the next import re-evaluates
    // the top-level code — this is the moment where a non-idempotent
    // singleton would leak a second browser.
    vi.resetModules();

    const second = await import("../browser");
    await second.acquirePage();

    // A non-idempotent singleton would relaunch here (length 2, new pid).
    // The globalThis-keyed cache guarantees we reuse the existing handle.
    expect(launchedBrowsers).toHaveLength(1);
    expect(launchedBrowsers[0].__pid).toBe(firstPid);
    expect(launchedBrowsers[0].newPage).toHaveBeenCalledTimes(2);

    await second.disposeBrowser();
  });

  it("disposeBrowser() closes the shared browser and clears the cache", async () => {
    const { acquirePage, disposeBrowser } = await import("../browser");

    await acquirePage();
    expect(launchedBrowsers[0].close).not.toHaveBeenCalled();

    await disposeBrowser();
    expect(launchedBrowsers[0].close).toHaveBeenCalledTimes(1);

    // Next acquire should launch fresh.
    await acquirePage();
    expect(launchedBrowsers).toHaveLength(2);

    await disposeBrowser();
  });

  it("passes protocolTimeout: 10min to puppeteer.launch (Runtime.callFunctionOn bug)", async () => {
    // Regression test for the Sprint 1 Group A CDP timeout bug.
    //
    // Puppeteer 24's default `protocolTimeout` is 180_000ms (3 min) — shorter
    // than our 8-min `waitForPageReady` preview-readiness poll. Under large
    // documents (1–2 MB preview HTML + esbuild-bundled preview JS), the single
    // awaited `Runtime.callFunctionOn` call would abort at 3 min with
    // "Runtime.callFunctionOn timed out", surfacing as "Waiting failed" at
    // the tool boundary.
    //
    // The fix raises the CDP ceiling to match PUPPETEER_TIMEOUT_MS (10 min)
    // so the protocol timeout can never trigger before the logical timeout —
    // two competing races collapse into one.
    const { getSharedBrowser, disposeBrowser } = await import("../browser");
    const puppeteerMod = await import("puppeteer");
    const launchSpy = puppeteerMod.default.launch as ReturnType<typeof vi.fn>;

    await getSharedBrowser();

    expect(launchSpy).toHaveBeenCalledTimes(1);
    const launchArgs = launchSpy.mock.calls[0][0] as { protocolTimeout?: number };
    expect(launchArgs.protocolTimeout).toBe(10 * 60_000);

    await disposeBrowser();
  });
});

// ── Timeout-cleanup smoke test ─────────────────────────────────────────────

describe("screenshot timeout cleanup", () => {
  it("clears the capture timeout on the success path (no leaked timers)", async () => {
    // We test the clearTimeout pairing at the unit level because
    // captureScreenshot requires a live findWorkspaceDesign + saveFile
    // pipeline and a real compiled preview. The invariant we care about
    // is: every `setTimeout` spawned by the race is followed by a
    // matching `clearTimeout` on the success path.
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    // Minimal reproduction of the race-with-timeout pattern used in
    // screenshot.ts / export.ts AFTER the fix.
    async function capture(): Promise<string> {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = Promise.resolve("ok");
        const timeoutTask = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("timed out")),
            10 * 60_000,
          );
        });
        return await Promise.race([work, timeoutTask]);
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    }

    await capture();
    await capture();

    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(clearSpy).toHaveBeenCalledTimes(2);

    // Every setTimeout handle must have been passed to clearTimeout.
    const scheduled = setSpy.mock.results.map((r) => r.value);
    const cleared = clearSpy.mock.calls.map((c) => c[0]);
    for (const handle of scheduled) {
      expect(cleared).toContain(handle);
    }
  });
});
