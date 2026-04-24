/**
 * W2.4 — globals.css resolution tests.
 *
 * Covers the `globalsCssPath` input contract:
 *   1. When the path resolves and the file is within the synced folder,
 *      `resolveAndReadGlobalsCss` returns the contents + a stable short
 *      hash suitable for the preview document stamp.
 *   2. When the path does NOT resolve (e.g. character has no synced
 *      folder containing that file), the helper throws
 *      `DesignWorkspaceGlobalsCssError` with `code: "GLOBALS_CSS_NOT_FOUND"`
 *      so the tool handler surfaces a structured envelope instead of a
 *      silent fallback.
 *   3. When the file exceeds `GLOBALS_CSS_MAX_BYTES`, the helper throws
 *      `code: "GLOBALS_CSS_TOO_LARGE"` with `bytes` + `limit` populated.
 *
 * We test the helper directly rather than driving the full
 * `buildTailwindPreviewWithMetadata` pipeline so these tests stay fast
 * and do not depend on esbuild / Tailwind / `postcss` infrastructure.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Mock the accessible-sync-folders helper so `resolveSyncedPath` treats
// our tmp dir as the character's only synced folder. This lets us exercise
// the real `resolveSyncedPath` / `isPathAllowed` logic without touching the
// sqlite DB or session metadata.
const accessibleSyncFoldersMock = vi.fn();
vi.mock("@/lib/vectordb/accessible-sync-folders", () => ({
  getAccessibleSyncFolders: (...args: unknown[]) => accessibleSyncFoldersMock(...args),
}));

// Session metadata lookup is not exercised here — returning `null` forces
// `resolveWorkspaceAwarePaths` to fall back to `resolveSyncedFolderPaths`.
vi.mock("@/lib/db/queries-sessions", () => ({
  getSession: vi.fn(async () => null),
}));

// `getWorkspaceInfo` is called on session metadata. We stub it to `null`
// so there's no active worktree — we want the base synced-folder path to
// be used directly.
vi.mock("@/lib/workspace/types", () => ({
  getWorkspaceInfo: () => null,
}));

// `logToolEvent` imports `sqlite-client` transitively; stub it out so the
// compiler module loads cleanly under the test harness.
vi.mock("@/lib/ai/tool-registry/logging", () => ({
  logToolEvent: vi.fn(),
}));

// Drizzle + sqlite are pulled in by path-utils via `findSimilarFiles`;
// we never call that path but the transitive import still loads the
// client. Stub it out defensively.
vi.mock("@/lib/db/sqlite-client", () => ({
  db: {},
}));

vi.mock("@/lib/db/sqlite-character-schema", () => ({
  agentSyncFiles: {},
}));

// Import AFTER the mocks so the compiler module sees them.
const { resolveAndReadGlobalsCss, GLOBALS_CSS_MAX_BYTES, isDesignWorkspaceGlobalsCssError } =
  await import("../compiler");

let tmpRoot: string;
let globalsPath: string;

const CHARACTER_ID = "test-char-w24";
const SESSION_ID = "test-session-w24";

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "w24-globals-"));
  // Mirror the real "sanity-seline/app/globals.css" shape inside the tmp
  // synced folder so the relative path we pass in looks realistic.
  await mkdir(join(tmpRoot, "sanity-seline", "app"), { recursive: true });
  globalsPath = join(tmpRoot, "sanity-seline", "app", "globals.css");
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("W2.4 resolveAndReadGlobalsCss", () => {
  it("reads the file and returns contents + a stable short hash when the path resolves", async () => {
    // Arrange: the character has the tmp root as its only synced folder.
    accessibleSyncFoldersMock.mockResolvedValue([{ folderPath: tmpRoot }]);
    const css = `:root { --brand: oklch(0.6 0.2 280); }\nbody { background: var(--brand); }\n`;
    await writeFile(globalsPath, css, "utf-8");

    // Act.
    const resolved = await resolveAndReadGlobalsCss({
      globalsCssPath: "sanity-seline/app/globals.css",
      characterId: CHARACTER_ID,
      sessionId: SESSION_ID,
    });

    // Assert.
    expect(resolved.contents).toBe(css);
    expect(resolved.bytes).toBe(Buffer.byteLength(css, "utf-8"));
    expect(resolved.hash).toHaveLength(16);
    expect(resolved.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(resolved.path).toBe("sanity-seline/app/globals.css");
  });

  it("surfaces GLOBALS_CSS_NOT_FOUND when the path is outside any synced folder", async () => {
    // Arrange: synced folders exist, but the requested relative path
    // resolves to a file that does not exist.
    accessibleSyncFoldersMock.mockResolvedValue([{ folderPath: tmpRoot }]);

    // Act + Assert.
    let thrown: unknown;
    try {
      await resolveAndReadGlobalsCss({
        globalsCssPath: "does/not/exist.css",
        characterId: CHARACTER_ID,
        sessionId: SESSION_ID,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isDesignWorkspaceGlobalsCssError(thrown)).toBe(true);
    if (!isDesignWorkspaceGlobalsCssError(thrown)) throw new Error("unreachable");
    expect(thrown.code).toBe("GLOBALS_CSS_NOT_FOUND");
    expect(thrown.path).toBe("does/not/exist.css");
  });

  it("rejects files above GLOBALS_CSS_MAX_BYTES with GLOBALS_CSS_TOO_LARGE + byte counts", async () => {
    // Arrange.
    accessibleSyncFoldersMock.mockResolvedValue([{ folderPath: tmpRoot }]);
    const tooLargePath = join(tmpRoot, "sanity-seline", "app", "oversize.css");
    // One byte over the limit so the test doesn't waste memory.
    const oversize = "/* pad */\n".repeat(Math.ceil(GLOBALS_CSS_MAX_BYTES / 10)) + "x";
    expect(Buffer.byteLength(oversize, "utf-8")).toBeGreaterThan(GLOBALS_CSS_MAX_BYTES);
    await writeFile(tooLargePath, oversize, "utf-8");

    // Act + Assert.
    let thrown: unknown;
    try {
      await resolveAndReadGlobalsCss({
        globalsCssPath: "sanity-seline/app/oversize.css",
        characterId: CHARACTER_ID,
        sessionId: SESSION_ID,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isDesignWorkspaceGlobalsCssError(thrown)).toBe(true);
    if (!isDesignWorkspaceGlobalsCssError(thrown)) throw new Error("unreachable");
    expect(thrown.code).toBe("GLOBALS_CSS_TOO_LARGE");
    expect(thrown.path).toBe("sanity-seline/app/oversize.css");
    expect(thrown.limit).toBe(GLOBALS_CSS_MAX_BYTES);
    expect(thrown.bytes).toBeGreaterThan(GLOBALS_CSS_MAX_BYTES);
  });

  it("rejects non-.css extensions before reading the file", async () => {
    // Arrange: the path doesn't even need to exist — the extension check
    // runs before resolveSyncedPath.
    accessibleSyncFoldersMock.mockResolvedValue([{ folderPath: tmpRoot }]);

    // Act + Assert.
    let thrown: unknown;
    try {
      await resolveAndReadGlobalsCss({
        globalsCssPath: "sanity-seline/app/globals.scss",
        characterId: CHARACTER_ID,
        sessionId: SESSION_ID,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isDesignWorkspaceGlobalsCssError(thrown)).toBe(true);
    if (!isDesignWorkspaceGlobalsCssError(thrown)) throw new Error("unreachable");
    expect(thrown.code).toBe("GLOBALS_CSS_NOT_CSS");
  });

  it("rejects empty files with GLOBALS_CSS_EMPTY", async () => {
    accessibleSyncFoldersMock.mockResolvedValue([{ folderPath: tmpRoot }]);
    const emptyPath = join(tmpRoot, "sanity-seline", "app", "empty.css");
    await writeFile(emptyPath, "   \n\t\n", "utf-8");

    let thrown: unknown;
    try {
      await resolveAndReadGlobalsCss({
        globalsCssPath: "sanity-seline/app/empty.css",
        characterId: CHARACTER_ID,
        sessionId: SESSION_ID,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isDesignWorkspaceGlobalsCssError(thrown)).toBe(true);
    if (!isDesignWorkspaceGlobalsCssError(thrown)) throw new Error("unreachable");
    expect(thrown.code).toBe("GLOBALS_CSS_EMPTY");
  });
});
