/**
 * Sprint 2 W2.2 — `designWorkspace` "port" action coverage.
 *
 * Locks in three required invariants from the W2.2 spec:
 *
 *  1. `dryRun: true` (default) NEVER writes. It returns the unified diff,
 *     `applied: false`, and the pre-existing target metadata so the user
 *     can approve before committing.
 *  2. `dryRun: false` + `overwrite: true` performs an atomic write via
 *     `atomicWriteFile`, returns `applied: true`, and reports
 *     `bytesWritten` matching the component source.
 *  3. `dryRun: false` + `overwrite: false` on a differing existing target
 *     returns a structured error envelope with
 *     `errorCode: "TARGET_EXISTS_MUST_OVERWRITE"` — it does NOT throw and
 *     does NOT write.
 *
 * All heavy dependencies (DB, sandbox, fs) are mocked so this stays a
 * pure unit test. We drive the tool through `createDesignWorkspaceTool`
 * so the full dispatch + slim-result envelope is exercised.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const galleryServiceMocks = vi.hoisted(() => ({
  findWorkspaceDesign: vi.fn(),
  listWorkspaceDesigns: vi.fn(),
  saveDesignComponentRecord: vi.fn(),
}));

const galleryQueryMocks = vi.hoisted(() => ({
  updateDesignComponent: vi.fn(),
  findDesignComponentBySourcePath: vi.fn(),
}));

const syncServiceMocks = vi.hoisted(() => ({
  getAccessibleSyncFolders: vi.fn(),
}));

const sessionQueryMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

const workspaceInfoMocks = vi.hoisted(() => ({
  getWorkspaceInfo: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  realpath: vi.fn(),
  rename: vi.fn(),
  chmod: vi.fn(),
  unlink: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock registrations — MUST run before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock("@/lib/design/gallery/service", () => ({
  findWorkspaceDesign: galleryServiceMocks.findWorkspaceDesign,
  listWorkspaceDesigns: galleryServiceMocks.listWorkspaceDesigns,
  saveDesignComponentRecord: galleryServiceMocks.saveDesignComponentRecord,
}));

vi.mock("@/lib/design/gallery/queries", () => ({
  updateDesignComponent: galleryQueryMocks.updateDesignComponent,
  findDesignComponentBySourcePath: galleryQueryMocks.findDesignComponentBySourcePath,
}));

vi.mock("@/lib/vectordb/accessible-sync-folders", () => ({
  getAccessibleSyncFolders: syncServiceMocks.getAccessibleSyncFolders,
}));

vi.mock("@/lib/db/queries-sessions", () => ({
  getSession: sessionQueryMocks.getSession,
}));

vi.mock("@/lib/workspace/types", () => ({
  getWorkspaceInfo: workspaceInfoMocks.getWorkspaceInfo,
}));

vi.mock("@/lib/db/sqlite-client", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    exec: vi.fn(),
  })),
}));

vi.mock("@/lib/db/sqlite-character-schema", () => ({
  agentSyncFiles: {
    characterId: "characterId",
    relativePath: "relativePath",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(),
    like: vi.fn(),
    and: vi.fn(),
  };
});

vi.mock("fs/promises", () => ({
  readFile: fsMocks.readFile,
  writeFile: fsMocks.writeFile,
  access: fsMocks.access,
  stat: fsMocks.stat,
  mkdir: fsMocks.mkdir,
  realpath: fsMocks.realpath,
  rename: fsMocks.rename,
  chmod: fsMocks.chmod,
  unlink: fsMocks.unlink,
  default: {
    readFile: fsMocks.readFile,
    writeFile: fsMocks.writeFile,
    access: fsMocks.access,
    stat: fsMocks.stat,
    mkdir: fsMocks.mkdir,
    realpath: fsMocks.realpath,
    rename: fsMocks.rename,
    chmod: fsMocks.chmod,
    unlink: fsMocks.unlink,
  },
}));

// Heavy design-workspace deps the port action never touches — stub so the
// module can load without pulling puppeteer / esbuild / sandbox into the
// test process.
vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/design", () => ({
  generateCard: vi.fn(),
  editCard: vi.fn(),
}));

vi.mock("@/lib/design/libraries", () => ({
  detectAvailableLibraries: vi.fn(() => Promise.resolve([])),
  getAvailableLibrariesPrompt: vi.fn(() => ""),
}));

vi.mock("@/lib/design/workspace/export", () => ({
  exportDesignAsset: vi.fn(),
}));

vi.mock("@/lib/design/workspace/preview", () => ({
  buildDesignPreviewErrorHtml: vi.fn(() => ""),
}));

vi.mock("@/lib/design/workspace/compiler", () => ({
  buildTailwindPreviewWithMetadata: vi.fn(),
  isDesignWorkspaceCompileError: vi.fn(() => false),
  isDesignWorkspaceImportError: vi.fn(() => false),
}));

vi.mock("@/lib/design/workspace/config", () => ({
  DEFAULT_DESIGN_WORKSPACE_CONFIG: {},
  getDesignWorkspaceConfigFromSettingsRecord: vi.fn(() => ({})),
}));

vi.mock("@/lib/design/workspace/edit-history", () => ({
  finalizeDesignHistory: vi.fn(),
  initDesignHistory: vi.fn(),
  peekDesignHistory: vi.fn(),
  recordDesignHistory: vi.fn(),
}));

vi.mock("@/lib/design/workspace/dependencies", () => ({
  installSandboxPackages: vi.fn(),
}));

vi.mock("@/lib/design/workspace/validation", () => ({
  runPostEditValidation: vi.fn(),
}));

vi.mock("@/lib/storage/local-storage", () => ({
  getFullPathFromMediaRef: vi.fn(),
}));

vi.mock("@/lib/ai/tool-registry/logging", () => ({
  withToolLogging: vi.fn((_label: string, _sid: string | undefined, fn: unknown) => fn),
}));

vi.mock("@/lib/design/workspace/screenshot", () => ({
  captureScreenshot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports under test — AFTER mock registrations.
// ---------------------------------------------------------------------------

import { createDesignWorkspaceTool } from "@/lib/ai/tools/design-workspace-tool";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-port-" + Date.now();
const CHARACTER_ID = "char-port-test";
const USER_ID = "user-port-test";

const SYNCED_FOLDER = path.resolve(process.cwd(), "test-synced-folder");
const TARGET_REL_PATH = "components/HeroCard.tsx";
const TARGET_ABS_PATH = path.join(SYNCED_FOLDER, TARGET_REL_PATH);

const COMPONENT_ID = "cmp-port-1";
const COMPONENT_SOURCE = `export default function HeroCard() {
  return <div className="hero">Hello from workspace</div>;
}
`;
const EXISTING_TARGET_CONTENT = `export default function HeroCard() {
  return <div className="hero">Old content on disk</div>;
}
`;

function makeComponent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: COMPONENT_ID,
    name: "Hero Card",
    code: COMPONENT_SOURCE,
    mode: "tailwind",
    style: "default",
    prompt: "",
    userId: USER_ID,
    sessionId: SESSION_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTool(opts: { characterId?: string | null } = {}) {
  return createDesignWorkspaceTool({
    sessionId: SESSION_ID,
    userId: USER_ID,
    characterId: opts.characterId === undefined ? CHARACTER_ID : opts.characterId ?? undefined,
  });
}

async function runPort(
  input: Record<string, unknown>,
  opts: { characterId?: string | null } = {},
) {
  const tool = createTool(opts);
  // The tool exposes `execute` directly (no withToolLogging wrapper in tests
  // because it's mocked to a pass-through). Invoke via `tool.execute(input)`.
  const rawExecute = (tool as unknown as { execute: (input: unknown) => Promise<unknown> })
    .execute;
  return rawExecute({ action: "port", ...input });
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // resolveSyncedPath() happy path → character has a single allowed folder,
  // realpath returns the input as-is.
  syncServiceMocks.getAccessibleSyncFolders.mockResolvedValue([
    { folderPath: SYNCED_FOLDER },
  ]);
  sessionQueryMocks.getSession.mockResolvedValue(null);
  workspaceInfoMocks.getWorkspaceInfo.mockReturnValue(null);
  fsMocks.realpath.mockImplementation((p: string) => Promise.resolve(p));

  // DB lookup default: component exists with source COMPONENT_SOURCE.
  galleryServiceMocks.findWorkspaceDesign.mockResolvedValue(makeComponent());

  // atomicWriteFile internal fs calls — default to happy path.
  fsMocks.mkdir.mockResolvedValue(undefined);
  fsMocks.stat.mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
  fsMocks.writeFile.mockResolvedValue(undefined);
  fsMocks.rename.mockResolvedValue(undefined);
  fsMocks.chmod.mockResolvedValue(undefined);
  fsMocks.unlink.mockResolvedValue(undefined);
  fsMocks.access.mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Shared helper — the BA-4 refactor routed the port action's target read
// through `readSyncedFile`, which calls `stat` BEFORE `readFile`. Tests that
// simulate an existing target must therefore mock BOTH. Keep this in one
// place so behavior stays consistent if the port action's read cap changes.
function mockExistingTarget(content: string) {
  const size = Buffer.byteLength(content, "utf-8");
  fsMocks.stat.mockReset();
  fsMocks.stat.mockResolvedValue({
    isFile: () => true,
    size,
    mtimeMs: 1_700_000_000_000,
  } as never);
  fsMocks.readFile.mockResolvedValue(content);
}

describe("designWorkspace action=port", () => {
  describe("dry-run (default)", () => {
    it("returns a unified diff and does NOT write when target differs", async () => {
      // Target file on disk currently holds the old content.
      mockExistingTarget(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        // dryRun omitted → defaults to true
      })) as {
        success: boolean;
        action: string;
        data?: {
          applied?: boolean;
          diff?: string;
          diffTruncated?: boolean;
          targetExistedBefore?: boolean;
          targetSize?: number;
          targetPath?: string;
          targetRelativePath?: string;
          componentId?: string;
          bytesWritten?: number;
          message?: string;
        };
      };

      expect(result.success).toBe(true);
      expect(result.action).toBe("port");
      expect(result.data?.applied).toBe(false);
      expect(result.data?.targetExistedBefore).toBe(true);
      expect(result.data?.targetSize).toBe(
        Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8"),
      );
      expect(result.data?.componentId).toBe(COMPONENT_ID);
      expect(result.data?.targetRelativePath).toBe(TARGET_REL_PATH);
      // Unified diff is present and references the target path + content.
      expect(typeof result.data?.diff).toBe("string");
      expect(result.data?.diff).toContain(TARGET_REL_PATH);
      expect(result.data?.diff).toContain("Hello from workspace");
      expect(result.data?.diff).toContain("Old content on disk");
      expect(result.data?.diffTruncated).toBe(false);
      // Dry run MUST never touch the filesystem.
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      expect(fsMocks.rename).not.toHaveBeenCalled();
      // bytesWritten is not set on dry-run (only on actual writes).
      expect(result.data?.bytesWritten).toBeUndefined();
      expect(result.data?.message).toMatch(/Dry Run/i);
    });

    it("reports identical + no-op when target already matches the component", async () => {
      // Target file on disk matches the component source byte-for-byte.
      mockExistingTarget(COMPONENT_SOURCE);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
      })) as {
        success: boolean;
        data?: {
          applied?: boolean;
          diff?: string;
          targetExistedBefore?: boolean;
          message?: string;
        };
      };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(false);
      expect(result.data?.diff).toBe("");
      expect(result.data?.targetExistedBefore).toBe(true);
      expect(result.data?.message).toMatch(/already matches/i);
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("write with overwrite=true", () => {
    it("writes the component source atomically and reports applied=true + bytesWritten", async () => {
      // BA-4 routed the target read through `readSyncedFile`, which calls
      // `stat` before `readFile`. The Rev3-D1 CAS fix extended
      // `readSyncedFile` to return `mtimeMs` from THAT same stat, so the
      // handler no longer issues a follow-up `fs.stat`. After the
      // read-utils stat, `atomicWriteFile` calls stat once for mode
      // preservation — we use `mockResolvedValueOnce` to cover both.
      const existingSize = Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8");
      fsMocks.stat.mockReset();
      // First call: readSyncedFile's pre-read size+mtime probe.
      fsMocks.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: existingSize,
        mtimeMs: 1_700_000_000_000,
      } as never);
      // Second call: atomicWriteFile mode-preservation stat.
      fsMocks.stat.mockResolvedValueOnce({ mode: 0o644 } as never);
      fsMocks.readFile.mockResolvedValue(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        // Rev-C2: apply calls must either pass `expectedContentSha256` or
        // explicitly opt out of the freshness guard. The legacy "write
        // atomically" assertion doesn't care about freshness — it just
        // verifies the fs plumbing — so we opt out here.
        allowStaleWrite: true,
      })) as {
        success: boolean;
        data?: {
          applied?: boolean;
          bytesWritten?: number;
          targetExistedBefore?: boolean;
          targetPath?: string;
          targetRelativePath?: string;
          diff?: string;
          message?: string;
        };
      };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(true);
      expect(result.data?.bytesWritten).toBe(
        Buffer.byteLength(COMPONENT_SOURCE, "utf-8"),
      );
      expect(result.data?.targetExistedBefore).toBe(true);
      expect(result.data?.targetRelativePath).toBe(TARGET_REL_PATH);
      // atomicWriteFile writes to a tmp file then renames onto the target.
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
      const [writtenPath, writtenContent] = fsMocks.writeFile.mock.calls[0] ?? [];
      expect(writtenPath).toContain(TARGET_ABS_PATH);
      expect(writtenContent).toBe(COMPONENT_SOURCE);
      expect(fsMocks.rename).toHaveBeenCalledTimes(1);
      const renameArgs = fsMocks.rename.mock.calls[0] ?? [];
      expect(renameArgs[1]).toBe(TARGET_ABS_PATH);
      expect(result.data?.message).toMatch(/Overwrote/i);
    });
  });

  describe("overwrite guard", () => {
    it("refuses with TARGET_EXISTS_MUST_OVERWRITE when target differs and overwrite is omitted", async () => {
      mockExistingTarget(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        // overwrite omitted → defaults to false
        // Rev-C2: opt out of the freshness guard so we can exercise the
        // overwrite guard in isolation (otherwise the handler-level
        // pre-filesystem INVALID_INPUT would fire first).
        allowStaleWrite: true,
      })) as {
        success: boolean;
        action: string;
        error?: string;
        data?: {
          applied?: boolean;
          errorCode?: string;
          diff?: string;
          targetExistedBefore?: boolean;
          targetSize?: number;
        };
      };

      expect(result.success).toBe(false);
      expect(result.action).toBe("port");
      expect(result.data?.errorCode).toBe("TARGET_EXISTS_MUST_OVERWRITE");
      expect(result.data?.applied).toBe(false);
      expect(result.data?.targetExistedBefore).toBe(true);
      expect(typeof result.data?.diff).toBe("string");
      // Diff must be present in the refusal envelope so the user can see
      // exactly what WOULD have changed before deciding to re-run with
      // overwrite:true.
      expect(result.data?.diff).toContain("Old content on disk");
      expect(result.data?.diff).toContain("Hello from workspace");
      // Error message references overwrite:true opt-in.
      expect(result.error).toMatch(/overwrite:true/i);
      // No write was attempted.
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      expect(fsMocks.rename).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint 2 Rev-B (BA-warn-5) — port freshness guard
  // ---------------------------------------------------------------------------
  describe("freshness guard (BA-warn-5)", () => {
    it("emits a preflight sha256 on dry-run responses", async () => {
      mockExistingTarget(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
      })) as {
        success: boolean;
        data?: {
          preflight?: { contentSha256?: string; mtimeMs?: number | null };
        };
      };

      expect(result.success).toBe(true);
      expect(result.data?.preflight).toBeDefined();
      // SHA-256 hex digest — 64 lowercase hex chars.
      expect(result.data?.preflight?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects dryRun:false with PORT_STALE_DIFF when expectedContentSha256 mismatches current file", async () => {
      // Tests set up a stale preflight token — the actual on-disk
      // content is EXISTING_TARGET_CONTENT but the caller claims to
      // have hashed a different string during the earlier dry-run.
      mockExistingTarget(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256:
          "0000000000000000000000000000000000000000000000000000000000000000",
      })) as {
        success: boolean;
        error?: string;
        data?: {
          errorCode?: string;
          stalePortInfo?: { currentSha256?: string; expectedSha256?: string };
        };
      };

      expect(result.success).toBe(false);
      expect(result.data?.errorCode).toBe("PORT_STALE_DIFF");
      expect(result.data?.stalePortInfo?.expectedSha256).toBe(
        "0000000000000000000000000000000000000000000000000000000000000000",
      );
      expect(result.data?.stalePortInfo?.currentSha256).toMatch(/^[a-f0-9]{64}$/);
      // No write attempted — the freshness guard short-circuited.
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      expect(fsMocks.rename).not.toHaveBeenCalled();
    });

    it("applies normally when expectedContentSha256 matches the current content", async () => {
      // Compute the expected hash from the EXISTING_TARGET_CONTENT so
      // the guard round-trips. Using Node's crypto directly keeps the
      // assertion readable.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto");
      const expectedHash = createHash("sha256")
        .update(EXISTING_TARGET_CONTENT)
        .digest("hex");

      // Three stat calls total: (1) readSyncedFile pre-read + mtime probe
      // for the initial read, (2) readSyncedFile pre-read + mtime probe
      // for the freshness re-read, (3) atomicWriteFile mode-preservation.
      // The Rev3-D1 CAS fix removed the separate post-read `fs.stat`
      // calls — `readSyncedFile` now returns `mtimeMs` from the same
      // stat that gates the size check.
      const existingSize = Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8");
      fsMocks.stat.mockReset();
      fsMocks.stat.mockResolvedValue({
        isFile: () => true,
        size: existingSize,
        mtimeMs: 1_700_000_000_000,
        mode: 0o644,
      } as never);
      fsMocks.readFile.mockResolvedValue(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256: expectedHash,
      })) as {
        success: boolean;
        data?: { applied?: boolean; errorCode?: string };
      };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(true);
      expect(result.data?.errorCode).toBeUndefined();
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint 2 Rev-C2 — freshness guard is now HARD, not best-effort.
  //
  // The Rev-B implementation made `expectedContentSha256` optional; callers
  // who forgot it silently bypassed the race check. Rev-C2 flips the
  // default: apply calls MUST carry either `expectedContentSha256` or
  // `allowStaleWrite: true`. These tests lock that contract.
  // ---------------------------------------------------------------------------
  describe("Rev-C2 hard freshness guard", () => {
    it("rejects apply-after-dry-run without expectedContentSha256 via handler-level pre-filesystem validation", async () => {
      // Target would exist, but we should never read it — the validation
      // must fire BEFORE the filesystem is touched.
      mockExistingTarget(EXISTING_TARGET_CONTENT);
      fsMocks.readFile.mockClear();
      fsMocks.stat.mockClear();

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        // Intentionally omitting BOTH expectedContentSha256 AND allowStaleWrite
      })) as {
        success: boolean;
        error?: string;
        data?: {
          errorCode?: string;
          recoveryHint?: string;
          applied?: boolean;
        };
      };

      expect(result.success).toBe(false);
      expect(result.data?.errorCode).toBe("INVALID_INPUT");
      expect(result.error).toMatch(/expectedContentSha256/);
      expect(result.error).toMatch(/allowStaleWrite/);
      expect(result.data?.recoveryHint).toMatch(/dryRun:true/i);
      // Handler-level pre-filesystem reject: no fs reads, no writes.
      expect(fsMocks.readFile).not.toHaveBeenCalled();
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      expect(fsMocks.rename).not.toHaveBeenCalled();
    });

    it("allows apply-after-dry-run when allowStaleWrite:true is set explicitly", async () => {
      // Set up the existing target. The legacy "opt-out" path must
      // still work, it's just now EXPLICIT rather than implicit.
      const existingSize = Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8");
      fsMocks.stat.mockReset();
      fsMocks.stat.mockResolvedValue({
        isFile: () => true,
        size: existingSize,
        mtimeMs: 1_700_000_000_000,
        mode: 0o644,
      } as never);
      fsMocks.readFile.mockResolvedValue(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        allowStaleWrite: true,
      })) as {
        success: boolean;
        data?: { applied?: boolean; errorCode?: string };
      };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(true);
      expect(result.data?.errorCode).toBeUndefined();
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
      expect(fsMocks.rename).toHaveBeenCalledTimes(1);
    });

    it("applies with correct expectedContentSha256 (round-trip from dry-run)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto");
      const expectedHash = createHash("sha256")
        .update(EXISTING_TARGET_CONTENT)
        .digest("hex");

      const existingSize = Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8");
      fsMocks.stat.mockReset();
      fsMocks.stat.mockResolvedValue({
        isFile: () => true,
        size: existingSize,
        mtimeMs: 1_700_000_000_000,
        mode: 0o644,
      } as never);
      fsMocks.readFile.mockResolvedValue(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256: expectedHash,
      })) as {
        success: boolean;
        data?: { applied?: boolean; errorCode?: string; bytesWritten?: number };
      };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(true);
      expect(result.data?.errorCode).toBeUndefined();
      expect(result.data?.bytesWritten).toBe(
        Buffer.byteLength(COMPONENT_SOURCE, "utf-8"),
      );
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
    });

    it("rejects with PORT_STALE_DIFF when file mutated between dry-run and apply", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto");

      // Dry-run saw version A; the caller echoes back sha256(A).
      const contentSeenAtDryRun = "export default function A() { return null; }\n";
      const expectedHash = createHash("sha256")
        .update(contentSeenAtDryRun)
        .digest("hex");

      // But by the time apply arrives, the file has been mutated to
      // version B on disk. Both the initial read (for diff) and the
      // FINAL CAS re-read will see B. CAS must fire on the final
      // re-read and the hashes will not match.
      const contentAtApplyTime = "export default function B() { return null; }\n";
      const mutatedSize = Buffer.byteLength(contentAtApplyTime, "utf-8");
      fsMocks.stat.mockReset();
      fsMocks.stat.mockResolvedValue({
        isFile: () => true,
        size: mutatedSize,
        mtimeMs: 1_700_000_500_000,
        mode: 0o644,
      } as never);
      fsMocks.readFile.mockResolvedValue(contentAtApplyTime);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256: expectedHash,
      })) as {
        success: boolean;
        error?: string;
        data?: {
          errorCode?: string;
          stalePortInfo?: {
            currentSha256?: string;
            expectedSha256?: string;
            mtimeMs?: number | null;
          };
        };
      };

      expect(result.success).toBe(false);
      expect(result.data?.errorCode).toBe("PORT_STALE_DIFF");
      expect(result.data?.stalePortInfo?.expectedSha256).toBe(expectedHash);
      expect(result.data?.stalePortInfo?.currentSha256).toBe(
        createHash("sha256").update(contentAtApplyTime).digest("hex"),
      );
      // No write happened — the CAS stopped the apply.
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      expect(fsMocks.rename).not.toHaveBeenCalled();
    });

    it("catches a concurrent race: initial read OK, then a racer mutates, FINAL re-read notices", async () => {
      // This test simulates the tight race: the initial read (for
      // diff compute) sees the SAME content the dry-run saw, so the
      // diff is valid. A racer mutates the file BETWEEN that initial
      // read and the FINAL CAS revalidation. The final re-read sees
      // the fresh content and must reject.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto");

      const dryRunContent = EXISTING_TARGET_CONTENT;
      const racerContent = "export default function Racer() { return <div/>; }\n";
      const expectedHash = createHash("sha256")
        .update(dryRunContent)
        .digest("hex");

      // The implementation makes two calls to `readSyncedFile` (for the
      // target path) on apply:
      //   1. Initial read — for diff compute. Returns dry-run content.
      //   2. FINAL re-read — for CAS. Returns racer's content.
      // Each `readSyncedFile` triggers one `stat` (size + mtime probe)
      // and one `readFile`. The Rev3-D1 CAS fix REMOVED the separate
      // post-read `fs.stat` calls (they reopened the TOCTOU window).
      // `readSyncedFile` now returns `mtimeMs` from the same stat that
      // gates the size check, so the sequence is exactly:
      //   stat_probe_1, readFile_1,   (initial)
      //   stat_probe_2, readFile_2.   (final CAS)
      //
      // Mock `readFile` with `mockResolvedValueOnce` twice.
      const dryRunSize = Buffer.byteLength(dryRunContent, "utf-8");
      const racerSize = Buffer.byteLength(racerContent, "utf-8");

      fsMocks.stat.mockReset();
      // stat_probe_1 (readSyncedFile pre-read for initial read)
      fsMocks.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: dryRunSize,
        mtimeMs: 1_700_000_000_000,
        mode: 0o644,
      } as never);
      // stat_probe_2 (readSyncedFile pre-read for FINAL re-read — racer
      // has just mutated; this sees the new size + mtime, which flows
      // into `stalePortInfo.mtimeMs`.)
      fsMocks.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: racerSize,
        mtimeMs: 1_700_000_999_999,
        mode: 0o644,
      } as never);

      fsMocks.readFile.mockReset();
      fsMocks.readFile.mockResolvedValueOnce(dryRunContent); // initial read
      fsMocks.readFile.mockResolvedValueOnce(racerContent); // FINAL CAS read

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256: expectedHash,
      })) as {
        success: boolean;
        data?: {
          errorCode?: string;
          stalePortInfo?: {
            currentSha256?: string;
            expectedSha256?: string;
          };
        };
      };

      expect(result.success).toBe(false);
      expect(result.data?.errorCode).toBe("PORT_STALE_DIFF");
      expect(result.data?.stalePortInfo?.expectedSha256).toBe(expectedHash);
      expect(result.data?.stalePortInfo?.currentSha256).toBe(
        createHash("sha256").update(racerContent).digest("hex"),
      );
      // Both reads happened, but the racer-caused mismatch stopped the write.
      expect(fsMocks.readFile).toHaveBeenCalledTimes(2);
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      expect(fsMocks.rename).not.toHaveBeenCalled();
    });

    it("still allows dryRun:true without expectedContentSha256 (the whole point of dry-run)", async () => {
      mockExistingTarget(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        // No dryRun (defaults to true), no expectedContentSha256, no allowStaleWrite.
      })) as {
        success: boolean;
        data?: {
          applied?: boolean;
          errorCode?: string;
          preflight?: { contentSha256?: string };
        };
      };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(false);
      expect(result.data?.errorCode).toBeUndefined();
      // Preflight hash still returned — caller echoes this back on apply.
      expect(result.data?.preflight?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint 2 Rev3-D1 — CAS ordering + PORT_WRITE_FAILED envelope
  //
  // BA-block: the final CAS path used to do readSyncedFile → fs.stat
  // (informational) → atomicWriteFile. That middle `fs.stat` was an
  // extra async hop that re-opened the TOCTOU window. Rev3-D1 extended
  // `readSyncedFile` to return `mtimeMs` from the same stat that gates
  // its size check, so the handler no longer issues a separate stat and
  // the sequence is now: readSyncedFile(CAS re-read) → synchronous hash
  // compare → atomicWriteFile with NO intervening awaits.
  //
  // BA-warn-2: the atomicWriteFile failure envelope used to lack an
  // `errorCode`, breaking the "every envelope carries an actionable
  // code" rule. Rev3-D1 tags raw write failures with PORT_WRITE_FAILED.
  // ---------------------------------------------------------------------------
  describe("Rev3-D1 CAS ordering + PORT_WRITE_FAILED", () => {
    it("issues no fs.stat between the CAS re-read and atomicWriteFile (pure stat accounting)", async () => {
      // The whole-handler stat accounting on a successful CAS apply is:
      //   1. readSyncedFile (initial, for diff)  — 1 stat
      //   2. readSyncedFile (CAS re-read)        — 1 stat
      //   3. atomicWriteFile mode-preservation   — 1 stat
      // Total: EXACTLY 3 stats. If an intermediate informational
      // `fs.stat` ever sneaks back between the CAS hash comparison and
      // atomicWriteFile, this count would rise to 4 and the test fails.
      // This is the defense-in-depth assertion the BA requested: the
      // TOCTOU window is a function of the stat count between the
      // freshness hash check and the write.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto");
      const expectedHash = createHash("sha256")
        .update(EXISTING_TARGET_CONTENT)
        .digest("hex");

      const existingSize = Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8");
      fsMocks.stat.mockReset();
      fsMocks.stat.mockResolvedValue({
        isFile: () => true,
        size: existingSize,
        mtimeMs: 1_700_000_000_000,
        mode: 0o644,
      } as never);
      fsMocks.readFile.mockResolvedValue(EXISTING_TARGET_CONTENT);

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256: expectedHash,
      })) as { success: boolean; data?: { applied?: boolean } };

      expect(result.success).toBe(true);
      expect(result.data?.applied).toBe(true);
      // EXACTLY three stats. Four would indicate a post-CAS informational
      // stat has crept back in (TOCTOU regression).
      expect(fsMocks.stat).toHaveBeenCalledTimes(3);
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
      expect(fsMocks.rename).toHaveBeenCalledTimes(1);
    });

    it("returns PORT_WRITE_FAILED when atomicWriteFile throws (disk full / ENOSPC)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto");
      const expectedHash = createHash("sha256")
        .update(EXISTING_TARGET_CONTENT)
        .digest("hex");

      const existingSize = Buffer.byteLength(EXISTING_TARGET_CONTENT, "utf-8");
      fsMocks.stat.mockReset();
      fsMocks.stat.mockResolvedValue({
        isFile: () => true,
        size: existingSize,
        mtimeMs: 1_700_000_000_000,
        mode: 0o644,
      } as never);
      fsMocks.readFile.mockResolvedValue(EXISTING_TARGET_CONTENT);
      // atomicWriteFile uses writeFile → rename internally; fail the
      // write step to simulate ENOSPC / EROFS / permission denied.
      fsMocks.writeFile.mockRejectedValueOnce(
        Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        }),
      );

      const result = (await runPort({
        componentId: COMPONENT_ID,
        targetPath: TARGET_REL_PATH,
        dryRun: false,
        overwrite: true,
        expectedContentSha256: expectedHash,
      })) as {
        success: boolean;
        error?: string;
        data?: {
          errorCode?: string;
          applied?: boolean;
          targetRelativePath?: string;
          diff?: string;
        };
      };

      expect(result.success).toBe(false);
      expect(result.data?.errorCode).toBe("PORT_WRITE_FAILED");
      expect(result.data?.applied).toBe(false);
      // Error envelope still carries the diff + target metadata so the
      // agent can retry or escalate without re-reading state.
      expect(result.data?.targetRelativePath).toBe(TARGET_REL_PATH);
      expect(typeof result.data?.diff).toBe("string");
      expect(result.error).toMatch(/ENOSPC/);
      // Rename must NOT have happened — the tmp write failed first.
      expect(fsMocks.rename).not.toHaveBeenCalled();
    });
  });
});
