/**
 * Sprint 3 Rev-F1 — screenshot viewport-fit unit tests.
 *
 * Locks in the `resolveScreenshotCaptureOptions` contract that the W3.4
 * spec requires for renderMany grid captures:
 *
 *   - Non-renderMany captures keep the historical viewport-bound PNG
 *     semantics (fullPage: false, captureBeyondViewport: false). Existing
 *     export / screenshot tests rely on this.
 *   - renderMany captures auto-enable fullPage because the default 900px
 *     viewport clips the 4-row × 240px-min-height grid at 1440 width.
 *   - Callers can still opt out of the auto-enable by passing
 *     `fullPage: false` explicitly (pre-measured grid heights).
 *
 * Pure helper — no Puppeteer, no DOM, no esbuild. Runs in millisecond
 * scale and catches the viewport-fit regression BEFORE the integration
 * tests pay the browser-boot cost.
 */

import { describe, it, expect } from "vitest";
import { resolveScreenshotCaptureOptions } from "../screenshot";
import type { RenderManyCell } from "../compiler";

describe("resolveScreenshotCaptureOptions — Sprint 3 Rev-F1", () => {
  it("defaults to fullPage=false + captureBeyondViewport=false for non-renderMany captures", () => {
    expect(resolveScreenshotCaptureOptions({})).toEqual({
      fullPage: false,
      captureBeyondViewport: false,
    });
    // Explicit undefined renderMany behaves identically to omission.
    expect(
      resolveScreenshotCaptureOptions({ renderMany: undefined }),
    ).toEqual({
      fullPage: false,
      captureBeyondViewport: false,
    });
  });

  it("treats an EMPTY renderMany array as the non-renderMany path (no auto-enable)", () => {
    expect(resolveScreenshotCaptureOptions({ renderMany: [] })).toEqual({
      fullPage: false,
      captureBeyondViewport: false,
    });
  });

  it("auto-enables fullPage + captureBeyondViewport when renderMany has cells", () => {
    const cells: RenderManyCell[] = [
      { props: { variant: "primary" } },
      { props: { variant: "secondary" } },
    ];
    expect(resolveScreenshotCaptureOptions({ renderMany: cells })).toEqual({
      fullPage: true,
      captureBeyondViewport: true,
    });
  });

  it("auto-enables fullPage for a 24-cell grid (spec example: 6 cols × 4 rows > 900px)", () => {
    // Reproduces the BA warn: 24 cells with `minmax(240px, 1fr)` lays out
    // as 6 × 4 at 1440 viewport width; 4 × 240 = 960 > 900 viewport height.
    const cells: RenderManyCell[] = Array.from({ length: 24 }, (_, i) => ({
      props: { idx: i },
    }));
    expect(resolveScreenshotCaptureOptions({ renderMany: cells })).toEqual({
      fullPage: true,
      captureBeyondViewport: true,
    });
  });

  it("respects an explicit fullPage=false even when renderMany is present", () => {
    const cells: RenderManyCell[] = [{ props: {} }];
    expect(
      resolveScreenshotCaptureOptions({ renderMany: cells, fullPage: false }),
    ).toEqual({
      fullPage: false,
      captureBeyondViewport: false,
    });
  });

  it("respects an explicit fullPage=true even when renderMany is empty", () => {
    expect(
      resolveScreenshotCaptureOptions({ renderMany: [], fullPage: true }),
    ).toEqual({
      fullPage: true,
      captureBeyondViewport: true,
    });
    expect(resolveScreenshotCaptureOptions({ fullPage: true })).toEqual({
      fullPage: true,
      captureBeyondViewport: true,
    });
  });
});
