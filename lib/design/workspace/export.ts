import { execFile } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import puppeteer from "puppeteer";
import {
  buildSafeEnvironment,
  getBundledRuntimeInfo,
  resolveBundledNodeCommand,
} from "@/lib/command-execution/executor-runtime";
import { saveFile } from "@/lib/storage/local-storage";
import {
  buildDesignPreviewHtml,
  type DesignExportMode,
} from "./preview";
import { buildTailwindPreviewAsync } from "./compiler";
import { sanitizeHTML } from "@/lib/design/utils/sanitize";

export type DesignExportFormat = "html" | "react" | "png" | "video";
export type { DesignExportMode } from "./preview";

interface DesignExportOptions {
  code: string;
  format: DesignExportFormat;
  mode?: DesignExportMode;
  componentName?: string;
  sessionId?: string;
  width?: number;
  height?: number;
  scale?: number;
  durationMs?: number;
  fps?: number;
}

interface DesignExportResult {
  format: DesignExportFormat;
  code?: string;
  renderedHtml: string;
  url?: string;
  localPath?: string;
  filePath?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
}

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_SCALE = 2;
const DEFAULT_FPS = 24;
const DEFAULT_DURATION_MS = 2400;
const DEFAULT_PNG_EXPORT_PROGRESS = 0.68;
const MAX_VIDEO_FRAMES = 96;
const DEFAULT_COMPONENT_NAME = "Design Component";
const PREVIEW_READY_TIMEOUT_MS = 8 * 60_000; // 8 minutes — complex animated/video components can take 6-7 min to render
const VIDEO_EXPORT_TIMEOUT_MS = 12 * 60_000; // 12 minutes — covers preview-ready wait + frame capture + ffmpeg encoding

const PUPPETEER_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; script-src 'unsafe-inline'">`;

/**
 * Build export-ready preview HTML for any mode.
 * For HTML mode: synchronous (buildDesignPreviewHtml handles it).
 * For Tailwind mode: async esbuild compilation.
 */
async function buildExportPreviewHtml(opts: {
  code: string;
  mode?: DesignExportMode;
  componentName?: string;
  animated?: boolean;
  exportProgress?: number;
}): Promise<string> {
  const mode = opts.mode ?? "tailwind";
  if (mode === "tailwind") {
    return buildTailwindPreviewAsync(opts.code, opts.componentName || DEFAULT_COMPONENT_NAME);
  }
  return buildDesignPreviewHtml(opts);
}

/**
 * Inject a CSP meta tag into the HTML <head> so it applies to page.setContent() calls.
 * setExtraHTTPHeaders CSP is a no-op for setContent since there's no network request.
 */
function injectCspMeta(html: string): string {
  const headIdx = html.indexOf("<head>");
  if (headIdx !== -1) {
    return html.slice(0, headIdx + 6) + "\n" + PUPPETEER_CSP + "\n" + html.slice(headIdx + 6);
  }
  // No <head> tag — prepend CSP + wrap
  return `<head>${PUPPETEER_CSP}</head>\n${html}`;
}

function sanitizeComponentName(name?: string): string {
  const normalized = (name || "design-component")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "design-component";
}

async function waitForPageReady(page: import("puppeteer").Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 10_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
  // Both HTML and Tailwind (esbuild-compiled) modes use
  // data-preview-ready="true" on #selene-design-preview-root.
  // Also verify the root has rendered child content.
  await page.waitForFunction(
    () => {
      const root = document.getElementById("selene-design-preview-root");
      return (
        root?.getAttribute("data-preview-ready") === "true" &&
        (root.childElementCount > 0 || root.innerHTML.trim().length > 0)
      );
    },
    { timeout: PREVIEW_READY_TIMEOUT_MS }
  );
  // Allow one animation frame for final paint stabilization
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

const PUPPETEER_TIMEOUT_MS = 10 * 60_000; // 10 minutes — matches extended preview-ready timeout

async function createBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
    ],
  });
}

function resolveFfmpegCommand(): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const runtime = getBundledRuntimeInfo();
  const safeEnv = buildSafeEnvironment(runtime) as NodeJS.ProcessEnv;
  const resolved = resolveBundledNodeCommand("ffmpeg", [], safeEnv, runtime);
  return {
    command: resolved.command,
    args: resolved.args,
    env: resolved.env,
  };
}

function execFileAsync(
  command: string,
  args: string[],
  options: import("child_process").ExecFileOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function assertFfmpegAvailable(ffmpeg: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  try {
    await execFileAsync(ffmpeg.command, [...ffmpeg.args, "-version"], {
      env: ffmpeg.env,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`FFmpeg is unavailable for video export: ${message}`);
  }
}

async function renderPngExport(
  opts: Required<Pick<DesignExportOptions, "code" | "componentName" | "sessionId">> &
    Pick<DesignExportOptions, "width" | "height" | "scale" | "mode">
): Promise<DesignExportResult> {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const scale = opts.scale ?? DEFAULT_SCALE;
  const fileName = `${sanitizeComponentName(opts.componentName)}.png`;
  const renderedHtml = await buildExportPreviewHtml({
    code: opts.code,
    mode: opts.mode,
    componentName: opts.componentName,
    animated: true,
    exportProgress: DEFAULT_PNG_EXPORT_PROGRESS,
  });
  // Sanitize HTML as defense-in-depth before passing to Puppeteer
  const sanitizedHtml = injectCspMeta(sanitizeHTML(renderedHtml, { allowStyles: true, allowDataUrls: true }));
  const browser = await createBrowser();

  try {
    const renderTask = async () => {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.setContent(sanitizedHtml, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForPageReady(page);

      const screenshot = await page.screenshot({ type: "png", captureBeyondViewport: false });
      const buffer = Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot);
      return saveFile(buffer, opts.sessionId, fileName, "generated");
    };

    const timeoutTask = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("PNG export timed out")), PUPPETEER_TIMEOUT_MS)
    );

    const stored = await Promise.race([renderTask(), timeoutTask]);

    return {
      format: "png",
      renderedHtml,
      url: stored.url,
      localPath: stored.localPath,
      filePath: stored.filePath,
      fileName,
      width,
      height,
    };
  } finally {
    await browser.close();
  }
}

async function renderVideoExport(
  opts: Required<Pick<DesignExportOptions, "code" | "componentName" | "sessionId">> &
    Pick<DesignExportOptions, "width" | "height" | "scale" | "durationMs" | "fps" | "mode">
): Promise<DesignExportResult> {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const scale = opts.scale ?? 1;
  const fps = opts.fps ?? DEFAULT_FPS;
  const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
  const frameCount = Math.max(12, Math.min(MAX_VIDEO_FRAMES, Math.round((durationMs / 1000) * fps)));
  const fileName = `${sanitizeComponentName(opts.componentName)}.mp4`;
  const renderedHtml = await buildExportPreviewHtml({
    code: opts.code,
    mode: opts.mode,
    componentName: opts.componentName,
    animated: true,
  });
  const tempDir = mkdtempSync(join(tmpdir(), "selene-design-video-"));
  const framePattern = join(tempDir, "frame-%03d.png");
  const outputPath = join(tempDir, fileName);
  // Sanitize HTML as defense-in-depth before passing to Puppeteer
  const sanitizedHtml = injectCspMeta(sanitizeHTML(renderedHtml, { allowStyles: true, allowDataUrls: true }));
  const ffmpeg = resolveFfmpegCommand();
  await assertFfmpegAvailable(ffmpeg);
  const browser = await createBrowser();

  try {
    const renderTask = async (): Promise<DesignExportResult> => {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.setContent(sanitizedHtml, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForPageReady(page);

      for (let index = 0; index < frameCount; index += 1) {
        const progress = frameCount === 1 ? 1 : index / (frameCount - 1);
        const eased = 0.5 - 0.5 * Math.cos(progress * Math.PI);
        await page.evaluate((value) => {
          document.documentElement.style.setProperty("--export-progress", value.toFixed(4));
        }, eased);
        await page.screenshot({
          path: join(tempDir, `frame-${String(index).padStart(3, "0")}.png`),
          type: "png",
          captureBeyondViewport: false,
        });
      }

      await execFileAsync(
        ffmpeg.command,
        [
          ...ffmpeg.args,
          "-y",
          "-framerate",
          String(fps),
          "-i",
          framePattern,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        {
          env: ffmpeg.env,
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        }
      );

      const stored = await saveFile(readFileSync(outputPath), opts.sessionId, fileName, "generated");

      return {
        format: "video",
        renderedHtml,
        url: stored.url,
        localPath: stored.localPath,
        filePath: stored.filePath,
        fileName,
        width,
        height,
        durationMs,
        fps,
      };
    };

    const timeoutTask = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Video export timed out")), VIDEO_EXPORT_TIMEOUT_MS)
    );

    return await Promise.race([renderTask(), timeoutTask]);
  } finally {
    await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function exportDesignAsset(opts: DesignExportOptions): Promise<DesignExportResult> {
  const code = opts.code?.trim();
  if (!code) {
    throw new Error("Component code is required for export.");
  }

  const mode = opts.mode ?? "tailwind";
  const componentName = opts.componentName || DEFAULT_COMPONENT_NAME;
  const sessionId = opts.sessionId || "design-workspace";

  if (opts.format === "html") {
    return {
      format: "html",
      code,
      renderedHtml: await buildExportPreviewHtml({ code, mode, componentName }),
      fileName: `${sanitizeComponentName(componentName)}.html`,
      width: opts.width ?? DEFAULT_WIDTH,
      height: opts.height ?? DEFAULT_HEIGHT,
    };
  }

  if (opts.format === "react") {
    return {
      format: "react",
      code,
      renderedHtml: await buildExportPreviewHtml({ code, mode, componentName }),
      fileName: `${sanitizeComponentName(componentName)}.tsx`,
      width: opts.width ?? DEFAULT_WIDTH,
      height: opts.height ?? DEFAULT_HEIGHT,
    };
  }

  if (opts.format === "png") {
    return renderPngExport({
      code,
      mode,
      componentName,
      sessionId,
      width: opts.width,
      height: opts.height,
      scale: opts.scale,
    });
  }

  return renderVideoExport({
    code,
    mode,
    componentName,
    sessionId,
    width: opts.width,
    height: opts.height,
    scale: opts.scale,
    durationMs: opts.durationMs,
    fps: opts.fps,
  });
}
