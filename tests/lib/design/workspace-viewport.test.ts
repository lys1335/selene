import { describe, expect, it } from "vitest";
import {
  DESIGN_CAPTURE_VIEWPORT,
  DESIGN_PREVIEW_PADDING,
  computeDesignPreviewFrameLayout,
  resolveDesignPreviewViewport,
} from "@/lib/design/workspace/viewport";
import type { DesignBreakpoint } from "@/lib/design/workspace/types";

describe("design preview viewport layout", () => {
  it("uses the shared capture viewport for responsive previews", () => {
    const responsive: DesignBreakpoint = { name: "responsive", width: 0, height: 0 };

    expect(resolveDesignPreviewViewport(responsive)).toEqual({
      viewportWidth: DESIGN_CAPTURE_VIEWPORT.width,
      viewportHeight: DESIGN_CAPTURE_VIEWPORT.height,
      usesDesignViewport: true,
    });
  });

  it("scales the shared responsive viewport to fit a narrow pane without reflowing", () => {
    const layout = computeDesignPreviewFrameLayout({
      breakpoint: { name: "responsive", width: 0, height: 0 },
      availableWidth: 480,
      availableHeight: 360,
    });

    const usableWidth = 480 - DESIGN_PREVIEW_PADDING * 2;
    const usableHeight = 360 - DESIGN_PREVIEW_PADDING * 2;
    const expectedScale = Math.min(
      usableWidth / DESIGN_CAPTURE_VIEWPORT.width,
      usableHeight / DESIGN_CAPTURE_VIEWPORT.height,
      1,
    );

    expect(layout.viewportWidth).toBe(DESIGN_CAPTURE_VIEWPORT.width);
    expect(layout.viewportHeight).toBe(DESIGN_CAPTURE_VIEWPORT.height);
    expect(layout.scale).toBeCloseTo(expectedScale, 5);
    expect(layout.scaledWidth).toBeCloseTo(DESIGN_CAPTURE_VIEWPORT.width * expectedScale, 5);
    expect(layout.scaledHeight).toBeCloseTo(DESIGN_CAPTURE_VIEWPORT.height * expectedScale, 5);
  });

  it("preserves explicit breakpoint dimensions when a device viewport is selected", () => {
    const layout = computeDesignPreviewFrameLayout({
      breakpoint: { name: "tablet", width: 768, height: 1024 },
      availableWidth: 1200,
      availableHeight: 1200,
    });

    expect(layout.viewportWidth).toBe(768);
    expect(layout.viewportHeight).toBe(1024);
    expect(layout.usesDesignViewport).toBe(false);
    expect(layout.scale).toBeLessThanOrEqual(1);
  });
});
