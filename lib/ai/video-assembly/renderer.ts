/**
 * Video Renderer
 *
 * Uses Remotion's renderer to create videos from assembly plans.
 * This module handles bundling, rendering, and output.
 *
 * IMPORTANT: Remotion packages (@remotion/bundler, @remotion/renderer) are
 * dynamically imported at runtime to avoid Next.js webpack bundling issues.
 * These packages contain webpack/esbuild dependencies that conflict with
 * Next.js's build process.
 */

import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getRelativeMediaPath } from "@/lib/storage/local-storage";
import { nanoid } from "nanoid";
import type { VideoAssemblyPlan, VideoAssemblyConfig } from "./types";
import { getTotalFrames } from "./remotion/types";
import { REMOTION_MEDIA_TOKEN } from "@/lib/config/remotion-media-token";

/**
 * Progress callback type
 */
export type RenderProgressCallback = (progress: {
  percent: number;
  renderedFrames: number;
  totalFrames: number;
  estimatedTimeRemaining?: number;
}) => void;

/**
 * Render result
 */
export interface RenderResult {
  outputPath: string;
  outputLocalPath: string;
  url: string;
  duration: number;
  width: number;
  height: number;
}

// Use globalThis to persist across Next.js hot reloads (same pattern as file-watcher.ts)
const _global = globalThis as typeof globalThis & {
  remotionBundleCache?: string | null;
  remotionBundlePromise?: Promise<string> | null;
};

function getCachedBundleUrl(): string | null {
  return _global.remotionBundleCache ?? null;
}

function setCachedBundleUrl(url: string | null): void {
  _global.remotionBundleCache = url;
}

function getBundlePromise(): Promise<string> | null {
  return _global.remotionBundlePromise ?? null;
}

function setBundlePromise(promise: Promise<string> | null): void {
  _global.remotionBundlePromise = promise;
}

/**
 * Dynamically import Remotion bundler
 * This avoids Next.js webpack trying to bundle these Node.js-only packages
 */
async function importRemotion() {
  const [bundlerModule, rendererModule] = await Promise.all([
    import("@remotion/bundler"),
    import("@remotion/renderer"),
  ]);
  const rendererWithCancel = rendererModule as typeof rendererModule & {
    isUserCancelledRender?: (err: unknown) => boolean;
    cancelErrorMessages?: {
      renderMedia: string;
      renderFrames: string;
      renderStill: string;
      stitchFramesToVideo: string;
    };
  };
  const cancelErrorMessages =
    rendererWithCancel.cancelErrorMessages ?? {
      renderMedia: "renderMedia() got cancelled",
      renderFrames: "renderFrames() got cancelled",
      renderStill: "renderStill() got cancelled",
      stitchFramesToVideo: "stitchFramesToVideo() got cancelled",
    };
  const isUserCancelledRender =
    rendererWithCancel.isUserCancelledRender ??
    ((err: unknown) => {
      if (
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof err.message === "string"
      ) {
        return (
          err.message.includes(cancelErrorMessages.renderMedia) ||
          err.message.includes(cancelErrorMessages.renderFrames) ||
          err.message.includes(cancelErrorMessages.renderStill) ||
          err.message.includes(cancelErrorMessages.stitchFramesToVideo)
        );
      }
      return false;
    });
  return {
    bundle: bundlerModule.bundle,
    renderMedia: rendererModule.renderMedia,
    selectComposition: rendererModule.selectComposition,
    makeCancelSignal: rendererModule.makeCancelSignal,
    isUserCancelledRender,
  };
}

/**
 * Get or create the Remotion bundle
 */
async function getBundle(): Promise<string> {
  const cached = getCachedBundleUrl();
  if (cached) {
    return cached;
  }

  const existing = getBundlePromise();
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    console.log("[VIDEO-RENDERER] Bundling Remotion composition...");

    const { bundle } = await importRemotion();

    // Path to the Remotion entry point
    const entryPoint = join(
      process.cwd(),
      "lib/ai/video-assembly/remotion/index.tsx"
    );

    // Determine the server URL for media access
    // In Electron production, the server runs on port 3456
    const isElectronProd = process.env.ELECTRON_USER_DATA_PATH && process.env.NODE_ENV === "production";
    const serveUrl = isElectronProd
      ? "http://localhost:3456"
      : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

    const mediaToken = REMOTION_MEDIA_TOKEN;

    console.log("[VIDEO-RENDERER] Using serve URL for media:", serveUrl);

    // Bundle the composition with environment variables for the browser context
    const bundleUrl = await bundle({
      entryPoint,
      // Enable React for JSX
      webpackOverride: (config) => {
        // Inject REMOTION_SERVE_URL into the bundle so Scene.tsx can use it
        const webpack = require("webpack");

        return {
          ...config,
          resolve: {
            ...config.resolve,
            extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
          },
          plugins: [
            ...(config.plugins || []),
            new webpack.DefinePlugin({
              "process.env.REMOTION_SERVE_URL": JSON.stringify(serveUrl),
              "process.env.REMOTION_MEDIA_TOKEN": JSON.stringify(mediaToken),
            }),
          ],
        };
      },
    });

    console.log("[VIDEO-RENDERER] Bundle created at:", bundleUrl);
    setCachedBundleUrl(bundleUrl);
    return bundleUrl;
  })();

  setBundlePromise(promise);
  return promise;
}

/**
 * Get the output path for rendered videos
 */
function getOutputPath(sessionId: string, format: string): string {
  const basePath = process.env.LOCAL_DATA_PATH || join(process.cwd(), ".local-data");
  const mediaPath = join(basePath, "media", sessionId, "generated");

  if (!existsSync(mediaPath)) {
    mkdirSync(mediaPath, { recursive: true });
  }

  const filename = `video-${nanoid()}.${format}`;
  return join(mediaPath, filename);
}

/**
 * Convert output path to URL
 */
function pathToUrl(outputPath: string, sessionId: string): string {
  const basePath = process.env.LOCAL_DATA_PATH || join(process.cwd(), ".local-data");
  const mediaRoot = join(basePath, "media");
  const relativePath = outputPath.startsWith(mediaRoot)
    ? outputPath.slice(mediaRoot.length + 1)
    : outputPath;
  const normalized = relativePath.replace(/\\/g, "/");
  return `/api/media/${normalized}`;
}

/**
 * Retry helper for transient failures (does NOT retry user cancellations)
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, delayMs: number, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Never retry user cancellations
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      if (attempt < maxAttempts) {
        console.warn(`[VIDEO-RENDERER] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`, error instanceof Error ? error.message : error);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Render a video from an assembly plan
 */
export async function renderVideo(
  plan: VideoAssemblyPlan,
  config: VideoAssemblyConfig,
  sessionId: string,
  onProgress?: RenderProgressCallback,
  abortSignal?: AbortSignal
): Promise<RenderResult> {
  console.log("[VIDEO-RENDERER] Starting video render...");
  console.log(`[VIDEO-RENDERER] Plan: ${plan.scenes.length} scenes, ${plan.totalDuration}s duration`);

  // Dynamically import Remotion at runtime
  const { selectComposition, renderMedia, makeCancelSignal, isUserCancelledRender } = await importRemotion();
  if (abortSignal?.aborted) {
    const error = new Error("Video assembly cancelled");
    error.name = "AbortError";
    throw error;
  }

  // Get the bundle
  const bundleUrl = await getBundle();

  // Calculate total frames
  const totalFrames = getTotalFrames(plan);
  console.log(`[VIDEO-RENDERER] Total frames: ${totalFrames}`);

  // Select the composition with our plan as props
  const composition = await selectComposition({
    serveUrl: bundleUrl,
    id: "VideoAssembly",
    inputProps: { plan },
  });

  // Override composition settings with our plan
  const compositionWithPlan = {
    ...composition,
    width: plan.outputWidth,
    height: plan.outputHeight,
    fps: plan.fps,
    durationInFrames: totalFrames,
    props: { plan },
  };

  // Get output path
  const outputPath = getOutputPath(sessionId, config.outputFormat);
  console.log(`[VIDEO-RENDERER] Output path: ${outputPath}`);

  // Track render start time for ETA calculation
  const startTime = Date.now();
  let lastRenderedFrames = 0;

  // Render the video
  // Increase timeout for video loading - Remotion needs time to fetch and decode video assets
  const { cancelSignal, cancel } = makeCancelSignal();
  const abortHandler = () => cancel();
  if (abortSignal) {
    abortSignal.addEventListener("abort", abortHandler);
  }

  try {
    await withRetry(
      () => renderMedia({
        composition: compositionWithPlan,
        serveUrl: bundleUrl,
        codec: config.codec === "h264" ? "h264" : config.codec === "h265" ? "h265" : "vp8",
        outputLocation: outputPath,
        inputProps: { plan },
        cancelSignal,
        // Increase timeout for video asset loading (default is 30s, we allow 300s / 5 minutes)
        timeoutInMilliseconds: 300000,
        onProgress: ({ renderedFrames }) => {
          const percent = Math.round((renderedFrames / totalFrames) * 100);

          // Calculate estimated time remaining
          let estimatedTimeRemaining: number | undefined;
          if (renderedFrames > lastRenderedFrames && renderedFrames > 0) {
            const elapsedMs = Date.now() - startTime;
            const framesPerMs = renderedFrames / elapsedMs;
            const remainingFrames = totalFrames - renderedFrames;
            estimatedTimeRemaining = Math.round(remainingFrames / framesPerMs / 1000);
          }
          lastRenderedFrames = renderedFrames;

          if (onProgress) {
            onProgress({
              percent,
              renderedFrames,
              totalFrames,
              estimatedTimeRemaining,
            });
          }
        },
      }),
      2,     // maxAttempts
      2000,  // delayMs
      "renderMedia"
    );
  } catch (error) {
    if (isUserCancelledRender(error)) {
      const abortError = new Error("Video assembly cancelled");
      abortError.name = "AbortError";
      throw abortError;
    }
    throw error;
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener("abort", abortHandler);
    }
  }

  console.log("[VIDEO-RENDERER] Render complete:", outputPath);

  // Return render result
  const url = pathToUrl(outputPath, sessionId);

  return {
    outputPath,
    outputLocalPath: getRelativeMediaPath(url) || outputPath,
    url,
    duration: plan.totalDuration,
    width: plan.outputWidth,
    height: plan.outputHeight,
  };
}

/**
 * Clear the bundle cache (useful for development)
 */
export function clearBundleCache(): void {
  setCachedBundleUrl(null);
  setBundlePromise(null);
}

