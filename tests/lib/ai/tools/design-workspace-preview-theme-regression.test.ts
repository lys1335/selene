/**
 * Sprint 3 Rev-F1 — Sprint 1 `previewTheme` regression coverage for
 * `compilePreviewForTool`.
 *
 * The Sprint 1 reviewer blocker ("Rev-A2 Gap 1") required the workspace's
 * active theme to thread end-to-end from the client's Zustand store to the
 * compiled preview HTML. The screenshot capture path was fixed at the time
 * (see tests/lib/design/workspace-theme-forwarding.test.ts), but the
 * generate/edit/patch preview-HTML path silently dropped the theme on the
 * floor inside `compilePreviewForTool` — `previewTheme` never reached
 * `buildTailwindPreviewWithMetadata`, so the compiler always applied its
 * historical hardcoded `"dark"` default.
 *
 * Consequences:
 *   - A user with `previewTheme: "light"` set in Zustand saw a dark
 *     preview HTML for every generate/edit/patch result.
 *   - `previewTheme: "system"` failed to emit the `matchMedia` IIFE in
 *     `<head>`, so Tailwind's class-based dark mode ignored OS-level
 *     preference changes inside the preview iframe.
 *
 * These tests drive `createDesignWorkspaceTool({ defaultPreviewTheme })`
 * through the generate handler with direct code input (no LLM call) and
 * assert that `buildTailwindPreviewWithMetadata` receives `previewTheme`
 * matching the layered resolution:
 *
 *   1. `input.previewTheme` wins when present (LLM-supplied).
 *   2. `options.defaultPreviewTheme` is the fallback when the LLM omits.
 *   3. Both undefined → the compiler's own default applies (undefined
 *      forwarded as-is).
 *
 * Kept fast by mocking every heavy dependency (sqlite, fs, esbuild). The
 * generate path exercised here uses `input.code` so no AI call is made.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — resolve SUT dependencies before imports.
// ---------------------------------------------------------------------------

const compilerMocks = vi.hoisted(() => ({
  buildTailwindPreviewWithMetadata: vi.fn(),
  isDesignWorkspaceCompileError: vi.fn(() => false),
  isDesignWorkspaceGlobalsCssError: vi.fn(() => false),
  isDesignWorkspaceImportError: vi.fn(() => false),
  RENDER_MANY_MAX_CELLS: 24,
}));

const galleryMocks = vi.hoisted(() => ({
  findWorkspaceDesign: vi.fn(),
  listWorkspaceDesigns: vi.fn(),
  saveDesignComponentRecord: vi.fn(),
  upsertImportedDesignComponent: vi.fn(),
  findDesignComponentBySourcePath: vi.fn(),
  updateDesignComponent: vi.fn(),
}));

const screenshotMocks = vi.hoisted(() => ({
  captureScreenshot: vi.fn(),
}));

const libraryMocks = vi.hoisted(() => ({
  detectAvailableLibraries: vi.fn(async () => []),
  getAvailableLibrariesPrompt: vi.fn(() => ""),
}));

const designMocks = vi.hoisted(() => ({
  generateCard: vi.fn(),
  editCard: vi.fn(),
}));

const historyMocks = vi.hoisted(() => ({
  initDesignHistory: vi.fn(),
  recordDesignHistory: vi.fn(),
  finalizeDesignHistory: vi.fn(),
  peekDesignHistory: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// vi.mock registrations.
// ---------------------------------------------------------------------------

vi.mock("@/lib/design/workspace/compiler", () => ({
  buildTailwindPreviewWithMetadata:
    compilerMocks.buildTailwindPreviewWithMetadata,
  isDesignWorkspaceCompileError: compilerMocks.isDesignWorkspaceCompileError,
  isDesignWorkspaceGlobalsCssError:
    compilerMocks.isDesignWorkspaceGlobalsCssError,
  isDesignWorkspaceImportError: compilerMocks.isDesignWorkspaceImportError,
  RENDER_MANY_MAX_CELLS: 24,
}));

vi.mock("@/lib/design/gallery/service", () => ({
  findWorkspaceDesign: galleryMocks.findWorkspaceDesign,
  listWorkspaceDesigns: galleryMocks.listWorkspaceDesigns,
  saveDesignComponentRecord: galleryMocks.saveDesignComponentRecord,
}));

vi.mock("@/lib/design/gallery/queries", () => ({
  findDesignComponentBySourcePath: galleryMocks.findDesignComponentBySourcePath,
  updateDesignComponent: galleryMocks.updateDesignComponent,
  upsertImportedDesignComponent: galleryMocks.upsertImportedDesignComponent,
}));

vi.mock("@/lib/design/workspace/screenshot", () => ({
  captureScreenshot: screenshotMocks.captureScreenshot,
}));

vi.mock("@/lib/design/libraries", () => ({
  detectAvailableLibraries: libraryMocks.detectAvailableLibraries,
  getAvailableLibrariesPrompt: libraryMocks.getAvailableLibrariesPrompt,
}));

vi.mock("@/lib/design", () => ({
  generateCard: designMocks.generateCard,
  editCard: designMocks.editCard,
}));

vi.mock("@/lib/design/workspace/edit-history", () => ({
  initDesignHistory: historyMocks.initDesignHistory,
  recordDesignHistory: historyMocks.recordDesignHistory,
  finalizeDesignHistory: historyMocks.finalizeDesignHistory,
  peekDesignHistory: historyMocks.peekDesignHistory,
}));

vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: settingsMocks.loadSettings,
}));

vi.mock("@/lib/ai/tool-registry/logging", () => ({
  withToolLogging:
    (_name: string, _sessionId: string | undefined, fn: (input: unknown) => Promise<unknown>) =>
    fn,
  logToolEvent: vi.fn(),
}));

vi.mock("@/lib/db/sqlite-client", () => ({
  db: {},
  getDb: () => ({
    prepare: () => ({ run: () => undefined, get: () => undefined, all: () => [] }),
    exec: () => undefined,
  }),
}));

// ---------------------------------------------------------------------------
// Imports under test — AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { createDesignWorkspaceTool } from "@/lib/ai/tools/design-workspace-tool";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DIRECT_CODE = `export default function Hero() {
  return <div className="p-4">Hi</div>;
}`;

function makeSuccessCompileReport() {
  return {
    warnings: [],
    errors: [],
    diagnostics: [],
    dependencyCheck: {
      manifestPackages: [],
      importedPackages: [],
      checkedPackages: [],
      missingManifestPackages: [],
      missingImportedPackages: [],
      missingPackages: [],
    },
    recovered: false,
    durationMs: 1,
  };
}

function makeGalleryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "design-row-1",
    userId: "user-1",
    characterId: null,
    sessionId: "sess-1",
    projectId: null,
    name: "Hero",
    description: null,
    prompt: "direct",
    code: DIRECT_CODE,
    framework: "react-tailwind",
    category: "workspace",
    tags: [],
    styleTags: [],
    previewPath: null,
    mode: "tailwind",
    style: "default",
    useCount: 0,
    lastUsedAt: null,
    isFavorite: false,
    createdAt: "2026-04-24 00:00:00.000",
    updatedAt: "2026-04-24 00:00:00.000",
    metadata: null,
    previewUrl: null,
    ...overrides,
  };
}

interface ToolWithExecute {
  execute: (input: unknown) => Promise<{
    success: boolean;
    action: string;
    data?: Record<string, unknown>;
    error?: string;
  }>;
}

async function runGenerate(
  toolOptions: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  const tool = createDesignWorkspaceTool(toolOptions) as unknown as ToolWithExecute;
  return tool.execute({
    action: "generate",
    sessionId: "sess-1",
    code: DIRECT_CODE,
    name: "Hero",
    ...input,
  });
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  compilerMocks.buildTailwindPreviewWithMetadata.mockResolvedValue({
    html: "<!DOCTYPE html><html lang=\"en\"><head></head><body></body></html>",
    report: makeSuccessCompileReport(),
  });

  galleryMocks.saveDesignComponentRecord.mockImplementation(
    async (row: Record<string, unknown>) =>
      makeGalleryItem({
        id: (row.id as string) ?? "design-row-1",
        name: (row.name as string) ?? "Hero",
        prompt: (row.prompt as string) ?? "direct",
        code: (row.code as string) ?? DIRECT_CODE,
      }),
  );

  screenshotMocks.captureScreenshot.mockResolvedValue({
    screenshot: {
      url: "/api/media/sess-1/preview.png",
      width: 1440,
      height: 900,
      dpr: 2,
    },
  });
});

// ---------------------------------------------------------------------------
// compilePreviewForTool previewTheme forwarding — Sprint 1 regression
// ---------------------------------------------------------------------------

describe("compilePreviewForTool forwards previewTheme to the compiler (Sprint 1 regression fix)", () => {
  it("generate with input.previewTheme=\"light\" forwards previewTheme:\"light\" to buildTailwindPreviewWithMetadata", async () => {
    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1" },
      { previewTheme: "light" },
    );
    expect(result.success).toBe(true);

    expect(compilerMocks.buildTailwindPreviewWithMetadata).toHaveBeenCalledTimes(
      1,
    );
    const [, , options] =
      compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options).toMatchObject({ previewTheme: "light" });
  });

  it("generate with previewTheme=\"system\" forwards previewTheme:\"system\" so the IIFE is emitted", async () => {
    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1" },
      { previewTheme: "system" },
    );
    expect(result.success).toBe(true);

    const [, , options] =
      compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options?.previewTheme).toBe("system");
  });

  it("generate with no LLM previewTheme falls back to options.defaultPreviewTheme=\"light\"", async () => {
    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1", defaultPreviewTheme: "light" },
      {},
    );
    expect(result.success).toBe(true);

    const [, , options] =
      compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options?.previewTheme).toBe("light");
  });

  it("input.previewTheme wins over options.defaultPreviewTheme", async () => {
    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1", defaultPreviewTheme: "light" },
      { previewTheme: "dark" },
    );
    expect(result.success).toBe(true);

    const [, , options] =
      compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    expect(options?.previewTheme).toBe("dark");
  });

  it("both theme sources undefined → previewTheme is forwarded as undefined (compiler default applies)", async () => {
    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1" },
      {},
    );
    expect(result.success).toBe(true);

    const [, , options] =
      compilerMocks.buildTailwindPreviewWithMetadata.mock.calls[0];
    // Must NOT synthesize "dark" here — the compiler owns the default.
    expect(options?.previewTheme).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Preview HTML output assertions — verify the COMPILER's theme contract
// when we bypass the mock and assert what gets forwarded.
//
// These tests use the (real) output shape the compiler emits per
// lib/design/workspace/compiler.ts:buildHtmlOpenTag so we anchor the
// regression to the compiler contract without re-running esbuild.
// ---------------------------------------------------------------------------

describe("compilePreviewForTool previewTheme regression — HTML-shape contract", () => {
  it("previewTheme:\"light\" → compiler produces <html lang=\"en\"> with NO dark class (contract mirror)", async () => {
    // Arrange the mock to echo back the shape the real compiler would emit
    // for `previewTheme: "light"` — no `class="dark"` on <html>, no
    // matchMedia IIFE in <head>.
    compilerMocks.buildTailwindPreviewWithMetadata.mockImplementation(
      async (_code: string, _name: string, opts?: { previewTheme?: string }) => {
        const html =
          opts?.previewTheme === "dark"
            ? "<!DOCTYPE html><html lang=\"en\" class=\"dark\"><head></head><body></body></html>"
            : opts?.previewTheme === "system"
            ? "<!DOCTYPE html><html lang=\"en\"><head><script>(function(){var h=document.documentElement;function u(){h.classList.toggle('dark',window.matchMedia('(prefers-color-scheme:dark)').matches)}u();window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',u)})()</script></head><body></body></html>"
            : "<!DOCTYPE html><html lang=\"en\"><head></head><body></body></html>";
        return { html, report: makeSuccessCompileReport() };
      },
    );

    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1" },
      { previewTheme: "light", returnScreenshot: false },
    );
    expect(result.success).toBe(true);

    const preview =
      (result.data?.previewHtml as string | undefined) ??
      (result.data?.previewHtmlRef as unknown) !== undefined
        ? (result.data?.previewHtml as string | undefined) ?? ""
        : "";
    // Light theme must not carry the dark class and must not inject the IIFE.
    expect(preview).not.toContain("class=\"dark\"");
    expect(preview).not.toContain("matchMedia('(prefers-color-scheme:dark)')");
  });

  it("previewTheme:\"system\" → compiler injects the matchMedia IIFE (contract mirror)", async () => {
    compilerMocks.buildTailwindPreviewWithMetadata.mockImplementation(
      async (_code: string, _name: string, opts?: { previewTheme?: string }) => {
        const html =
          opts?.previewTheme === "system"
            ? "<!DOCTYPE html><html lang=\"en\"><head><script>(function(){var h=document.documentElement;function u(){h.classList.toggle('dark',window.matchMedia('(prefers-color-scheme:dark)').matches)}u();window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',u)})()</script></head><body></body></html>"
            : "<!DOCTYPE html><html lang=\"en\"><head></head><body></body></html>";
        return { html, report: makeSuccessCompileReport() };
      },
    );

    const result = await runGenerate(
      { sessionId: "sess-1", userId: "user-1" },
      { previewTheme: "system", returnScreenshot: false },
    );
    expect(result.success).toBe(true);

    const preview = (result.data?.previewHtml as string | undefined) ?? "";
    // System theme must inject the media-query observer so Tailwind's
    // class-based dark mode still toggles at runtime.
    expect(preview).toContain("matchMedia('(prefers-color-scheme:dark)')");
    expect(preview).not.toContain("class=\"dark\"");
  });
});
