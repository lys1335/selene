/**
 * Provider-aware screenshot optimization.
 * Resizes and compresses screenshots before sending to AI providers.
 *
 * This module runs entirely in the renderer (browser) process using the
 * Canvas API. No Node.js / Electron main process involvement.
 */

export type ImageProvider = "anthropic" | "openai" | "google" | "default";

export interface OptimizationOptions {
  provider?: ImageProvider;
  /** Maximum output width in pixels. Aspect ratio is preserved. */
  maxWidthPx?: number;
  /** Maximum output height in pixels. Aspect ratio is preserved. */
  maxHeightPx?: number;
  /** JPEG quality, 0–1 (ignored for PNG). */
  quality?: number;
  format?: "jpeg" | "png" | "webp";
}

/**
 * Per-provider default optimization configurations.
 *
 * Limits are chosen to stay within each provider's documented image-size
 * constraints while keeping token costs reasonable.
 */
export const PROVIDER_CONFIGS: Record<ImageProvider, Required<OptimizationOptions>> = {
  anthropic: { provider: "anthropic", maxWidthPx: 1568, maxHeightPx: 1568, quality: 0.85, format: "jpeg" },
  openai:    { provider: "openai",    maxWidthPx: 2048, maxHeightPx: 2048, quality: 0.90, format: "jpeg" },
  google:    { provider: "google",    maxWidthPx: 3072, maxHeightPx: 3072, quality: 0.90, format: "jpeg" },
  default:   { provider: "default",   maxWidthPx: 1920, maxHeightPx: 1080, quality: 0.85, format: "jpeg" },
};

/**
 * Return the merged optimization config for a given provider string.
 * Falls back to "default" for unrecognised provider identifiers.
 */
export function getProviderConfig(provider: string): Required<OptimizationOptions> {
  const key = provider as ImageProvider;
  return PROVIDER_CONFIGS[key] ?? PROVIDER_CONFIGS.default;
}

/**
 * Estimate the token cost of an image using Anthropic's tile-based formula.
 *
 * Anthropic charges per 512×512 tile that covers the image after it has been
 * resized to fit within 1568×1568.  The minimum is 1 tile (85 tokens), and
 * the base overhead is 85 tokens on top of the tile cost.
 *
 * Reference: https://docs.anthropic.com/en/docs/vision
 */
export function estimateImageTokens(widthPx: number, heightPx: number): number {
  // Clamp to Anthropic's effective max resolution
  const TILE_SIZE = 512;
  const BASE_TOKENS = 85;
  const TOKENS_PER_TILE = 170;

  const clampedWidth  = Math.min(widthPx,  1568);
  const clampedHeight = Math.min(heightPx, 1568);

  const tilesX = Math.ceil(clampedWidth  / TILE_SIZE);
  const tilesY = Math.ceil(clampedHeight / TILE_SIZE);
  const tiles  = tilesX * tilesY;

  return BASE_TOKENS + tiles * TOKENS_PER_TILE;
}

/**
 * Compute the output dimensions that fit `srcWidth × srcHeight` inside
 * `maxWidth × maxHeight` while preserving the aspect ratio.
 */
function computeOutputDimensions(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (srcWidth <= maxWidth && srcHeight <= maxHeight) {
    return { width: srcWidth, height: srcHeight };
  }

  const scaleX = maxWidth  / srcWidth;
  const scaleY = maxHeight / srcHeight;
  const scale  = Math.min(scaleX, scaleY);

  return {
    width:  Math.round(srcWidth  * scale),
    height: Math.round(srcHeight * scale),
  };
}

/**
 * Client-side (browser) screenshot optimization using the Canvas API.
 *
 * Fetches `imageUrl`, draws it onto an off-screen canvas scaled to the
 * provider's limits, then exports as a compressed Blob.
 *
 * @param imageUrl  Absolute or relative URL of the source image (e.g. `/api/media/screenshots/...`)
 * @param options   Override any of the default optimization parameters
 * @returns         A compressed image Blob ready to be uploaded or converted to a data URL
 */
export async function optimizeScreenshot(
  imageUrl: string,
  options: OptimizationOptions = {},
): Promise<Blob> {
  // Resolve effective config — caller overrides trump provider defaults
  const providerKey = options.provider ?? "default";
  const providerDefaults = getProviderConfig(providerKey);

  const maxWidthPx  = options.maxWidthPx  ?? providerDefaults.maxWidthPx;
  const maxHeightPx = options.maxHeightPx ?? providerDefaults.maxHeightPx;
  const quality     = options.quality     ?? providerDefaults.quality;
  const format      = options.format      ?? providerDefaults.format;

  const mimeType = format === "png" ? "image/png"
    : format === "webp" ? "image/webp"
    : "image/jpeg";

  // Load the source image
  const img = await loadImage(imageUrl);

  const { width, height } = computeOutputDimensions(
    img.naturalWidth,
    img.naturalHeight,
    maxWidthPx,
    maxHeightPx,
  );

  // Draw onto an off-screen canvas
  const canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("[image-optimization] Failed to get 2D canvas context");
  }

  ctx.drawImage(img, 0, 0, width, height);

  // Export as Blob
  return canvasToBlob(canvas, mimeType, format === "png" ? undefined : quality);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = (err) => reject(
      new Error(`[image-optimization] Failed to load image: ${url} — ${String(err)}`),
    );
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number | undefined,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("[image-optimization] canvas.toBlob returned null"));
        }
      },
      mimeType,
      quality,
    );
  });
}
