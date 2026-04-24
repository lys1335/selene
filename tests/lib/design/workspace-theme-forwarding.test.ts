/**
 * Regression coverage for the Sprint 1 "theme threading" reviewer blockers.
 *
 * Locks in three invariants:
 *
 *  1. `captureScreenshot({ theme: "light", ... })` forwards
 *     `previewTheme: "light"` to `buildTailwindPreviewWithMetadata`, so the
 *     Puppeteer-rendered screenshot / computed-style probes match the
 *     user's active workspace theme instead of always rendering dark.
 *  2. `captureScreenshot({ theme: "system", ... })` forwards
 *     `previewTheme: "system"` to the compiler, which is the only path that
 *     injects the `<head>` IIFE observing `prefers-color-scheme` (needed
 *     because the preview Tailwind config uses `darkMode: "class"`).
 *  3. `designWorkspaceToModelOutput` carries the captured screenshot URL
 *     through the media envelope unchanged — reviewers flagged that the
 *     theme-forwarding fix is only observable end-to-end if the envelope
 *     still surfaces the media URL to the agent.
 *
 * We mock the heavy esbuild + puppeteer entrypoints so this stays a
 * millisecond-scale unit test and does not touch the sandbox or browser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks for the captureScreenshot dependencies
// ---------------------------------------------------------------------------

const compilerMocks = vi.hoisted(() => ({
  buildTailwindPreviewWithMetadata: vi.fn(),
}));

const galleryMocks = vi.hoisted(() => ({
  findWorkspaceDesign: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  saveFile: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  PUPPETEER_TIMEOUT_MS: 60_000,
  buildExportPreviewHtml: vi.fn(),
  injectCspMeta: vi.fn((html: string) => html),
  sanitizeComponentName: vi.fn((name?: string) => (name ?? "x").toLowerCase()),
  waitForPageReady: vi.fn().mockResolvedValue(undefined),
}));

const browserMocks = vi.hoisted(() => {
  const page = {
    setViewport: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png-bytes")),
    evaluate: vi.fn().mockResolvedValue(2),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    page,
    // `acquirePage()` resolves to a Page directly (per browser.ts), not a
    // `{ page, release }` pair. See lib/design/workspace/browser.ts:118.
    acquirePage: vi.fn().mockResolvedValue(page),
  };
});

const sanitizeMocks = vi.hoisted(() => ({
  sanitizeHTML: vi.fn((html: string) => html),
}));

vi.mock("@/lib/design/workspace/compiler", () => ({
  buildTailwindPreviewWithMetadata: compilerMocks.buildTailwindPreviewWithMetadata,
}));

vi.mock("@/lib/design/gallery/service", () => ({
  findWorkspaceDesign: galleryMocks.findWorkspaceDesign,
}));

vi.mock("@/lib/storage/local-storage", () => ({
  saveFile: storageMocks.saveFile,
}));

vi.mock("@/lib/design/utils/sanitize", () => ({
  sanitizeHTML: sanitizeMocks.sanitizeHTML,
}));

vi.mock("@/lib/design/workspace/export", () => exportMocks);

// The browser module is Rev-A3's scope; mock it so this test does not
// require Chromium.
vi.mock("@/lib/design/workspace/browser", () => ({
  acquirePage: browserMocks.acquirePage,
}));

// ---------------------------------------------------------------------------
// Imports under test — AFTER mocks are registered
// ---------------------------------------------------------------------------

import { captureScreenshot } from "@/lib/design/workspace/screenshot";
import {
  designWorkspaceToModelOutput,
  maybeCaptureScreenshot,
} from "@/lib/ai/tools/design-workspace-tool";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  galleryMocks.findWorkspaceDesign.mockResolvedValue({
    id: "cmp_1",
    name: "Preview",
    code: "export default function X(){ return <div/> }",
    mode: "tailwind",
    style: "default",
    prompt: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  compilerMocks.buildTailwindPreviewWithMetadata.mockResolvedValue({
    html: "<!DOCTYPE html><html lang=\"en\"><head></head><body></body></html>",
    report: {
      warnings: [],
      errors: [],
      dependencyCheck: {
        manifestPackages: [],
        importedPackages: [],
        checkedPackages: [],
        missingManifestPackages: [],
        missingImportedPackages: [],
        missingPackages: [],
      },
      recovered: false,
      durationMs: 0,
    },
  });

  storageMocks.saveFile.mockResolvedValue({ url: "/api/media/sess/preview.png" });

  // Reset puppeteer page mocks to a known-good state so each assertion
  // starts from the same baseline (newPage/screenshot may be invoked
  // multiple times across a single capture in future revisions).
  browserMocks.page.screenshot.mockResolvedValue(Buffer.from("fake-png-bytes"));
  browserMocks.page.evaluate.mockResolvedValue(2);
});

// ---------------------------------------------------------------------------
// Theme forwarding — the reviewer blocker
// ---------------------------------------------------------------------------

describe("captureScreenshot — theme forwarding", () => {
  it("forwards theme=\"light\" to buildTailwindPreviewWithMetadata as previewTheme", async () => {
    await captureScreenshot({
      componentId: "cmp_1",
      sessionId: "sess",
      userId: "user",
      theme: "light",
    });

    expect(compilerMocks.buildTailwindPreviewWithMetadata).toHaveBeenCalledTimes(1);
    const [, , options] = compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options).toMatchObject({ previewTheme: "light" });
  });

  it("forwards theme=\"system\" so the compiler emits the matchMedia IIFE script", async () => {
    await captureScreenshot({
      componentId: "cmp_1",
      sessionId: "sess",
      userId: "user",
      theme: "system",
    });

    const [, , options] = compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options?.previewTheme).toBe("system");
  });

  it("does NOT silently default to \"dark\" when theme is omitted", async () => {
    await captureScreenshot({
      componentId: "cmp_1",
      sessionId: "sess",
      userId: "user",
    });

    // When the caller omits `theme`, screenshot.ts falls through to
    // buildExportPreviewHtml so the default-preview pipeline is reused.
    // The metadata-aware compiler must not be invoked with a hardcoded
    // "dark" in that path — the compiler's own default applies there.
    expect(compilerMocks.buildTailwindPreviewWithMetadata).not.toHaveBeenCalled();
    expect(exportMocks.buildExportPreviewHtml).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Envelope — forwarded screenshot URL
// ---------------------------------------------------------------------------

describe("designWorkspaceToModelOutput — screenshot envelope passthrough", () => {
  it("emits the captured screenshot url as an image media part", () => {
    const envelope = designWorkspaceToModelOutput({
      success: true,
      action: "generate",
      data: {
        componentId: "cmp_1",
        generatedAt: 123,
        screenshot: {
          url: "/api/media/sess/preview.png",
          width: 1440,
          height: 900,
          dpr: 2,
        },
      },
    });

    expect(envelope.type).toBe("content");
    if (envelope.type !== "content") return;

    const image = envelope.value.find((part) => part.type === "image");
    expect(image).toBeDefined();
    if (image && image.type === "image") {
      expect(image.source.url).toBe("/api/media/sess/preview.png");
    }
  });
});

// ---------------------------------------------------------------------------
// Gap 1 — defaultPreviewTheme forwarded from tool options
//
// Integration-style coverage for the Sprint 1 Rev-A2 Gap 1 blocker:
// "no caller populates DesignWorkspaceInput.previewTheme; omitted calls still
//  default compiled capture HTML to 'dark'."
//
// The fix threads the client's Zustand `previewTheme` through the chat
// request header → route → `createDesignWorkspaceTool({ defaultPreviewTheme })`.
// `maybeCaptureScreenshot` then layers the LLM's `input.previewTheme` ATOP
// the tool-scoped default, so the capture pipeline renders under the user's
// current theme even when the model omits the schema field.
// ---------------------------------------------------------------------------

describe("maybeCaptureScreenshot — defaultPreviewTheme threading (Gap 1)", () => {
  it("falls back to options.defaultPreviewTheme=\"light\" when input.previewTheme is omitted", async () => {
    await maybeCaptureScreenshot(
      { sessionId: "sess", userId: "user", defaultPreviewTheme: "light" },
      { action: "generate" },
      "cmp_1",
    );

    // The compiler-with-metadata path is the one that honors `previewTheme`.
    // When "light" threads through, screenshot.ts takes that branch (not the
    // default `buildExportPreviewHtml` path) and forwards previewTheme: "light".
    expect(compilerMocks.buildTailwindPreviewWithMetadata).toHaveBeenCalledTimes(1);
    const [, , options] = compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options).toMatchObject({ previewTheme: "light" });
    // Confirm the non-themed pipeline was NOT engaged — a regression here
    // would mean dark got baked in despite the client theme being "light".
    expect(exportMocks.buildExportPreviewHtml).not.toHaveBeenCalled();
  });

  it("falls back to options.defaultPreviewTheme=\"system\" when input.previewTheme is omitted", async () => {
    await maybeCaptureScreenshot(
      { sessionId: "sess", userId: "user", defaultPreviewTheme: "system" },
      { action: "generate" },
      "cmp_1",
    );

    expect(compilerMocks.buildTailwindPreviewWithMetadata).toHaveBeenCalledTimes(1);
    const [, , options] = compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    // "system" is the branch that injects the matchMedia IIFE; it MUST reach
    // the compiler, not fall through to the plain export path.
    expect(options?.previewTheme).toBe("system");
    expect(exportMocks.buildExportPreviewHtml).not.toHaveBeenCalled();
  });

  it("prefers input.previewTheme over options.defaultPreviewTheme when both are set", async () => {
    await maybeCaptureScreenshot(
      { sessionId: "sess", userId: "user", defaultPreviewTheme: "light" },
      { action: "generate", previewTheme: "dark" },
      "cmp_1",
    );

    const [, , options] = compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    // LLM-provided theme wins — default is only a fallback.
    expect(options?.previewTheme).toBe("dark");
  });

  it("preserves the original \"no theme anywhere\" behavior (compiler default path)", async () => {
    await maybeCaptureScreenshot(
      { sessionId: "sess", userId: "user" },
      { action: "generate" },
      "cmp_1",
    );

    // Neither the LLM nor the tool option provided a theme — we must NOT
    // synthesize "dark" and MUST fall through to the default preview
    // pipeline, matching the pre-Gap-1 omitted-theme contract.
    expect(compilerMocks.buildTailwindPreviewWithMetadata).not.toHaveBeenCalled();
    expect(exportMocks.buildExportPreviewHtml).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Sprint 3 Rev-F1 — renderMany viewport-fit (W3.4 FE warn).
//
// Locks in the Puppeteer `page.screenshot({ fullPage: ... })` contract:
// when a renderMany grid is present, the capture must extend past the
// default 900px viewport height so the bottom row of a 24-cell grid is
// not clipped. Also verifies the compiler is engaged on this path (the
// single-render `buildExportPreviewHtml` fallback does not thread
// renderMany, so a capture with renderMany must take the metadata path).
// ---------------------------------------------------------------------------

describe("captureScreenshot — renderMany viewport fit (Sprint 3 Rev-F1)", () => {
  it("enables fullPage + captureBeyondViewport on page.screenshot when renderMany is active", async () => {
    await captureScreenshot({
      componentId: "cmp_1",
      sessionId: "sess",
      userId: "user",
      renderMany: [{ props: { variant: "a" } }, { props: { variant: "b" } }],
    });

    // One screenshot invocation with fullPage AND captureBeyondViewport on.
    expect(browserMocks.page.screenshot).toHaveBeenCalledTimes(1);
    const screenshotArgs = browserMocks.page.screenshot.mock.calls[0][0] as {
      type: string;
      fullPage: boolean;
      captureBeyondViewport: boolean;
    };
    expect(screenshotArgs.fullPage).toBe(true);
    expect(screenshotArgs.captureBeyondViewport).toBe(true);
  });

  it("keeps the historical viewport-bound capture (fullPage:false) for non-renderMany flows", async () => {
    await captureScreenshot({
      componentId: "cmp_1",
      sessionId: "sess",
      userId: "user",
      theme: "light", // still engages the compiler path
    });

    const screenshotArgs = browserMocks.page.screenshot.mock.calls[0][0] as {
      fullPage: boolean;
      captureBeyondViewport: boolean;
    };
    expect(screenshotArgs.fullPage).toBe(false);
    expect(screenshotArgs.captureBeyondViewport).toBe(false);
  });

  it("forwards validated renderMany cells to the compiler so the grid HTML is emitted (not single-render)", async () => {
    const cells = [
      { props: { variant: "primary" } },
      { props: { variant: "secondary" } },
    ];
    await captureScreenshot({
      componentId: "cmp_1",
      sessionId: "sess",
      userId: "user",
      renderMany: cells,
    });

    // When renderMany is present, screenshot.ts MUST route through the
    // metadata-aware compiler (buildExportPreviewHtml does not thread
    // renderMany, so taking the fallback path would render a single
    // <Component /> instead of the grid).
    expect(compilerMocks.buildTailwindPreviewWithMetadata).toHaveBeenCalledTimes(1);
    const [, , options] = compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options?.renderMany).toEqual(cells);
    expect(exportMocks.buildExportPreviewHtml).not.toHaveBeenCalled();
  });
});
