/**
 * Sprint 1.5 — pin the probe-readiness invariant for computed-style probes.
 *
 * Background. T1.3 / T1.5 / T1.6 captured probe values that looked like the
 * pre-CSS DOM:
 *   - `font: "16px Times"`         — UA serif default, not Tailwind preflight.
 *   - `body { margin: 8px }`        — UA default, not Tailwind preflight reset.
 *   - `colorScheme: "normal"`      — neither `:root { color-scheme: light }`
 *     nor the system-IIFE-toggled `.dark` rule applied.
 *
 * Two mechanically distinct issues fed that report:
 *
 *   (a) Tailwind preflight emits `html { font-family: var(--font-inter), … }`
 *       but the standalone preview HTML has no `next/font` injection of
 *       `--font-inter`. With no inner var() fallback, CSS spec makes the
 *       *whole* font-family declaration invalid → UA serif default. Fix:
 *       define `--font-inter` (and `--font-jetbrains-mono`) at `:root` in
 *       `PREVIEW_THEME_CSS` so the cascade is valid and the resolved font
 *       is `Inter, ui-sans-serif, system-ui, sans-serif`.
 *
 *   (b) The probe step had no positive signal that the in-`<head>` `<style>`
 *       blocks had actually been parsed and applied before
 *       `getComputedStyle(...)` was called. Fix: emit a sentinel custom
 *       property `--selene-styles-applied: 1` at `:root` in
 *       `PREVIEW_THEME_CSS`, and have `waitForProbeStylesReady` poll for it
 *       before yielding to the probe pass.
 *
 * These tests pin both invariants at the contract layer — the constants
 * exposed by `screenshot.ts` and the CSS string emitted by `compiler.ts`
 * MUST stay aligned. Any rename / drop will fail these tests instead of
 * silently re-introducing the regression.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/local-storage", () => ({
  saveFile: vi.fn(),
}));

import {
  PROBE_STYLES_APPLIED_SENTINEL,
  waitForProbeStylesReady,
} from "../screenshot";
import { buildTailwindPreviewWithMetadata } from "../compiler";

describe("probe-styles readiness — sentinel handshake", () => {
  it("exposes the sentinel custom-property name as a stable export", () => {
    // Same string the regression test below greps for in PREVIEW_THEME_CSS
    // — a rename on either side breaks both tests instead of silently
    // making the probe race appear to "fix itself".
    expect(PROBE_STYLES_APPLIED_SENTINEL).toBe("--selene-styles-applied");
  });

  it("polls until the sentinel resolves to '1' before settling", async () => {
    let pollCount = 0;
    const fakePage = {
      evaluate: vi.fn(async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
        // We don't run the page-side function inside Node — instead we
        // simulate the calls the body would make and assert the contract:
        // the function is invoked once with the sentinel name + timeout +
        // poll interval, and only one evaluate call is dispatched.
        pollCount += 1;
        return fn(...args);
      }),
    };

    // Inject a minimal jsdom-like shim so the IIFE can run without a real
    // page: document.fonts.ready resolves immediately, getComputedStyle
    // returns the sentinel set to "1" on the first poll, and rAF fires
    // synchronously. The point is to verify waitForProbeStylesReady
    // returns without throwing and only invokes evaluate once.
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    try {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          documentElement: {},
          fonts: { ready: Promise.resolve() },
        },
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          getComputedStyle: () => ({
            getPropertyValue: () => "1",
          }),
        },
      });
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: (cb: FrameRequestCallback) => {
          cb(0);
          return 0;
        },
      });

      await waitForProbeStylesReady(fakePage);
    } finally {
      if (originalDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      if (originalWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      if (originalRaf === undefined) delete (globalThis as Record<string, unknown>).requestAnimationFrame;
      else
        Object.defineProperty(globalThis, "requestAnimationFrame", {
          configurable: true,
          value: originalRaf,
        });
    }

    expect(pollCount).toBe(1);
    expect(fakePage.evaluate).toHaveBeenCalledTimes(1);
    // The first arg is the page-side function; args 1..3 are sentinel
    // name + timeout + poll interval. Lock the sentinel-name argument so
    // the calling shape can't drift away from the constant export.
    const callArgs = fakePage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe(PROBE_STYLES_APPLIED_SENTINEL);
    expect(typeof callArgs[2]).toBe("number"); // timeout ms
    expect(typeof callArgs[3]).toBe("number"); // poll ms
  });
});

describe("PREVIEW_THEME_CSS — sentinel + font-var contract", () => {
  it("emits the sentinel custom property under the same name screenshot.ts polls", async () => {
    const code = `export default function X(){ return <div className="p-4">x</div>; }`;
    const { html } = await buildTailwindPreviewWithMetadata(code, "X", {
      autoInstallMissingDependencies: true,
      previewTheme: "light",
      source: "probe-styles-ready-test",
    });

    // The sentinel must be set on `:root` so the screenshot pipeline can
    // read it via getComputedStyle(documentElement).getPropertyValue.
    // We grep for the literal `--selene-styles-applied: 1;` declaration —
    // a rename without updating the constant export would break this.
    expect(html).toMatch(
      new RegExp(`${PROBE_STYLES_APPLIED_SENTINEL.replace("--", "--")}\\s*:\\s*1\\s*;`),
    );
    expect(html).toContain(PROBE_STYLES_APPLIED_SENTINEL);
  });

  it("defines --font-inter and --font-jetbrains-mono so Tailwind's font-family var() resolves", async () => {
    const code = `export default function X(){ return <div>x</div>; }`;
    const { html } = await buildTailwindPreviewWithMetadata(code, "X", {
      autoInstallMissingDependencies: true,
      previewTheme: "light",
      source: "probe-styles-ready-test",
    });

    // Without these, `html { font-family: var(--font-inter), ui-sans-serif, … }`
    // becomes invalid (no inner var fallback) and the browser falls back to
    // the UA serif default — surfacing as `font: "16px Times"` in probes.
    expect(html).toContain("--font-inter:");
    expect(html).toContain("--font-jetbrains-mono:");
  });

  it("preserves <html class=\"dark\"> through the sanitize+CSP pipeline so previewTheme: 'dark' actually applies", async () => {
    const { sanitizeHTML } = await import("@/lib/design/utils/sanitize");
    const { injectCspMeta } = await import("../export");
    const code = `export default function X(){ return <div className="p-4 dark:bg-gray-900 bg-white">x</div>; }`;
    const { html } = await buildTailwindPreviewWithMetadata(code, "X", {
      autoInstallMissingDependencies: true,
      previewTheme: "dark",
      source: "probe-styles-ready-test",
    });
    const finalHtml = injectCspMeta(
      sanitizeHTML(html, {
        allowStyles: true,
        allowDataUrls: true,
        allowInlineScripts: true,
      }),
    );

    // Regression — the sanitizer used to strip <html>/<head>/<body> entirely
    // because they aren't in the rich-text allowlist. That dropped
    // `class="dark"` on <html>, leaving Tailwind's `dark:` variants inert
    // and making `previewTheme: "dark"` indistinguishable from light in
    // screenshots. With STRUCTURAL_DOC_TAGS gated on allowInlineScripts,
    // the class survives.
    expect(finalHtml).toMatch(/<html\b[^>]*\bclass="dark"/);
  });
});
