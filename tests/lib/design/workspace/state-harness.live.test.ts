/**
 * Sprint 4 W4.1 Rev-J3 — live-Chromium CDP state harness test.
 *
 * L2 fix: the original `state-harness.test.ts` suite proves the CDP call
 * sequencing contract with a fully-mocked Page, but leaves the question
 * "does the pinned Chrome/Puppeteer runtime actually honor
 * `Emulation.setEmulatedPseudoState`?" unanswered. This test boots the real
 * shared browser, feeds a minimal HTML document with a visibly-different
 * `:hover` rule, forces `['hover']` via CDP, probes the element's computed
 * style + persists a screenshot, clears the state, and re-probes — asserting
 * that the computed `backgroundColor` differs between the forced and
 * baseline captures. If the CDP emulation silently no-ops on this runtime
 * (the L2 failure mode), the test fails with a meaningful diff on the
 * `backgroundColor` probe value instead of green-washing.
 *
 * Gated on `RUN_DESIGN_STATE_LIVE=true` so the default `vitest` run (and CI
 * envs without a Chromium install) skip the suite. Puppeteer is
 * dynamically launched in `beforeAll`; any failure there flips the suite
 * into skip-mode so a missing Chromium binary does NOT fail CI.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// -----------------------------------------------------------------------
// Stub `@/lib/storage/local-storage` so the real `saveFile` doesn't try to
// resolve the storage root / write to disk. The live test only needs to
// assert the harness successfully produced a PNG + cleared the forced
// state; persistence is exercised by the unit suite.
// -----------------------------------------------------------------------
vi.mock("@/lib/storage/local-storage", () => ({
  saveFile: vi.fn(
    async (_buf: Buffer, sessionId: string, filename: string) => ({
      localPath: `/tmp-live/${sessionId}/${filename}`,
      url: `/api/media/${sessionId}/${filename}`,
      filePath: `/tmp-live/${sessionId}/${filename}`,
    }),
  ),
}));

const runLive = process.env.RUN_DESIGN_STATE_LIVE === "true";

// HTML fixture: `.btn` starts red, turns green on `:hover`. The baseline
// capture + probe should see red; the forced-state capture + probe should
// see green. Colors are named with exact rgb() strings so the test can
// compare getComputedStyle() output verbatim (browsers normalize named
// colors to rgb()).
const FIXTURE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; padding: 24px; background: white; }
  .btn {
    display: inline-block;
    padding: 16px 32px;
    background: rgb(255, 0, 0);
    color: white;
    border: 2px solid black;
    font: 16px/1.2 sans-serif;
  }
  .btn:hover {
    background: rgb(0, 128, 0);
  }
</style>
</head>
<body>
  <button class="btn" type="button">State harness target</button>
</body>
</html>`;

describe.skipIf(!runLive)(
  "state harness — live Chromium CDP (Sprint 4 W4.1 Rev-J3 L2)",
  () => {
    let available = false;
    let browserMod: typeof import("@/lib/design/workspace/browser");
    let screenshotMod: typeof import("@/lib/design/workspace/screenshot");

    beforeAll(async () => {
      try {
        browserMod = await import("@/lib/design/workspace/browser");
        screenshotMod = await import("@/lib/design/workspace/screenshot");
        // Probe launch — if Chromium is not installed in this env, bail out
        // of the suite rather than failing with a puppeteer internal error.
        await browserMod.getSharedBrowser();
        available = true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          "[state-harness.live] Skipping — failed to launch shared browser:",
          error instanceof Error ? error.message : error,
        );
        available = false;
      }
    }, 60_000);

    afterAll(async () => {
      if (available && browserMod) {
        await browserMod.disposeBrowser().catch(() => undefined);
      }
    });

    it("forces `:hover` via CDP, captures a PNG, and clears state so the baseline re-renders", async () => {
      if (!available) return;

      const page = await browserMod.acquirePage();
      try {
        await page.setViewport({
          width: 640,
          height: 320,
          deviceScaleFactor: 1,
        });
        await page.setContent(FIXTURE_HTML, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });

        // Baseline probe — no CDP force yet. `.btn` background should be red.
        const baselineColor = await page.evaluate(() => {
          const el = document.querySelector(".btn");
          if (!el) return null;
          return window.getComputedStyle(el).backgroundColor;
        });
        expect(baselineColor).toBe("rgb(255, 0, 0)");

        // Drive the harness directly against this page so we exercise the
        // SAME `captureScreenshotUnderPseudoState` entry point production
        // uses. A successful capture proves:
        //   (a) CDP `Emulation.setEmulatedPseudoState({pseudoClass: ['hover']})`
        //       round-tripped on this runtime, AND
        //   (b) the Puppeteer Page rendered the hover variant into the PNG.
        const result = await screenshotMod.captureScreenshotUnderPseudoState({
          page,
          entry: { selector: ".btn", pseudo: "hover", label: "HoverLive" },
          viewport: { width: 640, height: 320, deviceScaleFactor: 1 },
          // Re-use the harness's own probe path to read back the
          // under-force computed style — this is the authoritative
          // "did the emulation take effect" assertion.
          probeSelectors: [".btn"],
          fileNameBase: "StateHarnessLive",
          sessionId: "live-sess",
          fullPage: false,
          captureBeyondViewport: false,
        });

        // The harness must produce a success envelope, not an error.
        if ("error" in result) {
          // eslint-disable-next-line no-console
          console.error("[state-harness.live] capture error:", result.error);
          throw new Error(
            `unexpected error envelope: ${result.error.code} ${result.error.message}`,
          );
        }
        expect("error" in result).toBe(false);
        expect(result.pseudo).toBe("hover");
        expect(result.selector).toBe(".btn");
        expect(result.screenshot.url).toMatch(/^\/api\/media\/live-sess\//);
        expect(result.screenshot.width).toBe(640);
        expect(result.screenshot.height).toBe(320);

        // Under-force probe: `.btn` must report the green hover color.
        // This is the CORE L2 assertion — if CDP emulation silently no-ops,
        // this field reverts to the red baseline and the test fails here.
        expect(result.probes).toBeDefined();
        expect(result.probes?.[".btn"]?.backgroundColor).toBe(
          "rgb(0, 128, 0)",
        );

        // After the harness finishes it clears the forced pseudo-state via
        // `Emulation.setEmulatedPseudoState({pseudoClass: []})`. A fresh
        // `page.evaluate` on the same page must therefore observe the red
        // baseline again — proving the clear call actually propagated and
        // did not leak hover state into the next probe.
        const afterClearColor = await page.evaluate(() => {
          const el = document.querySelector(".btn");
          if (!el) return null;
          return window.getComputedStyle(el).backgroundColor;
        });
        expect(afterClearColor).toBe("rgb(255, 0, 0)");
      } finally {
        await page.close().catch(() => undefined);
      }
    }, 60_000);

    it("rejects an unresolvable selector without persisting a screenshot", async () => {
      if (!available) return;

      const page = await browserMod.acquirePage();
      try {
        await page.setViewport({
          width: 320,
          height: 200,
          deviceScaleFactor: 1,
        });
        await page.setContent(FIXTURE_HTML, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });

        const result = await screenshotMod.captureScreenshotUnderPseudoState({
          page,
          entry: { selector: ".does-not-exist", pseudo: "hover" },
          viewport: { width: 320, height: 200, deviceScaleFactor: 1 },
          fileNameBase: "StateHarnessLive",
          sessionId: "live-sess-missing",
          fullPage: false,
          captureBeyondViewport: false,
        });

        expect("error" in result).toBe(true);
        if (!("error" in result)) throw new Error("unreachable");
        expect(result.error.code).toBe("STATE_SELECTOR_NOT_FOUND");
        expect(result.selector).toBe(".does-not-exist");
      } finally {
        await page.close().catch(() => undefined);
      }
    }, 30_000);
  },
);
