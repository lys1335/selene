import type { DesignBreakpoint } from "./types";

export const DESIGN_CAPTURE_VIEWPORT = {
  width: 1440,
  height: 900,
} as const;

export const DESIGN_PREVIEW_PADDING = 24;

export interface DesignPreviewFrameLayout {
  viewportWidth: number;
  viewportHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  scale: number;
  usesDesignViewport: boolean;
}

interface ComputeDesignPreviewFrameLayoutOptions {
  breakpoint: DesignBreakpoint;
  availableWidth: number;
  availableHeight: number;
  padding?: number;
}

export function resolveDesignPreviewViewport(
  breakpoint: DesignBreakpoint,
): Pick<DesignPreviewFrameLayout, "viewportWidth" | "viewportHeight" | "usesDesignViewport"> {
  if (breakpoint.width > 0 && breakpoint.height > 0) {
    return {
      viewportWidth: breakpoint.width,
      viewportHeight: breakpoint.height,
      usesDesignViewport: false,
    };
  }

  return {
    viewportWidth: DESIGN_CAPTURE_VIEWPORT.width,
    viewportHeight: DESIGN_CAPTURE_VIEWPORT.height,
    usesDesignViewport: true,
  };
}

export function computeDesignPreviewFrameLayout(
  options: ComputeDesignPreviewFrameLayoutOptions,
): DesignPreviewFrameLayout {
  const viewport = resolveDesignPreviewViewport(options.breakpoint);
  const padding = options.padding ?? DESIGN_PREVIEW_PADDING;

  if (options.availableWidth <= 0 || options.availableHeight <= 0) {
    return {
      ...viewport,
      scaledWidth: viewport.viewportWidth,
      scaledHeight: viewport.viewportHeight,
      scale: 1,
    };
  }

  const usableWidth = Math.max(options.availableWidth - padding * 2, 1);
  const usableHeight = Math.max(options.availableHeight - padding * 2, 1);
  const scale = Math.min(
    usableWidth / viewport.viewportWidth,
    usableHeight / viewport.viewportHeight,
    1,
  );

  return {
    ...viewport,
    scaledWidth: viewport.viewportWidth * scale,
    scaledHeight: viewport.viewportHeight * scale,
    scale,
  };
}
