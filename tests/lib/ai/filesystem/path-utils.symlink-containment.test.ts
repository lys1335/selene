/**
 * BA-1 regression coverage for `isPathAllowed`.
 *
 * The prior implementation checked containment by comparing the
 * UNRESOLVED target string when `realpath()` on both the candidate AND
 * its parent failed. Symlinks that pointed outside the allowed root
 * could smuggle a to-be-created file past the check:
 *
 *   /allowed/foo/symlink-to-outside -> /tmp/evil
 *   writing /allowed/foo/symlink-to-outside/newfile.tsx was accepted
 *   because `newfile.tsx` did not exist yet and the fallback string check
 *   only saw `/allowed/foo/symlink-to-outside/newfile.tsx`, which starts
 *   with the allowed root.
 *
 * The hardened implementation (see `path-utils.ts`) walks up the
 * candidate until it finds an ancestor that exists on disk, realpath()s
 * THAT ancestor, re-appends the trailing non-existent segments, and
 * compares the fully-realpathed path against the allowed root.
 *
 * These tests use the real filesystem (`fs.mkdtemp` + `fs.symlink`) so
 * the regression is exercised end-to-end, not against a mock of
 * `realpath`. Cleanup runs in an `afterAll` hook via `fs.rm(recursive)`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import { realpath } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

// The module under test only touches DB-backed helpers for the
// "find similar files" code path, which this suite does not invoke.
// Stub the DB surface defensively so the module loads in isolation.
vi.mock("@/lib/db/sqlite-client", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
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
    or: vi.fn(),
  };
});

vi.mock("@/lib/vectordb/sync-service", () => ({
  getSyncFolders: vi.fn(),
}));

import { isPathAllowed } from "@/lib/ai/filesystem/path-utils";

// Shared fixture directories populated in beforeAll + torn down in afterAll.
let allowedRoot: string;          // realpath'd synced folder (the "allowed" tree)
let outsideRoot: string;          // realpath'd directory that MUST be unreachable
let realSubdir: string;           // allowedRoot/normal-dir — exists
let symlinkEscape: string;        // allowedRoot/escape-link -> outsideRoot
let symlinkInside: string;        // allowedRoot/inside-link -> allowedRoot/normal-dir

beforeAll(async () => {
  // mkdtemp returns the realpath'd path on some platforms; use realpath
  // explicitly so the allowed roots we feed into isPathAllowed match what
  // realpath() returns for children of these roots (avoids spurious
  // /private prefix mismatches on macOS).
  const rawAllowedRoot = await fs.mkdtemp(path.join(tmpdir(), "selene-ba1-allowed-"));
  const rawOutsideRoot = await fs.mkdtemp(path.join(tmpdir(), "selene-ba1-outside-"));
  allowedRoot = await realpath(rawAllowedRoot);
  outsideRoot = await realpath(rawOutsideRoot);

  realSubdir = path.join(allowedRoot, "normal-dir");
  await fs.mkdir(realSubdir, { recursive: true });

  symlinkEscape = path.join(allowedRoot, "escape-link");
  await fs.symlink(outsideRoot, symlinkEscape, "dir");

  symlinkInside = path.join(allowedRoot, "inside-link");
  await fs.symlink(realSubdir, symlinkInside, "dir");
});

afterAll(async () => {
  // Defensive — ignore cleanup errors so a failing assertion above does
  // not cascade into a confusing teardown failure.
  if (allowedRoot) {
    await fs.rm(allowedRoot, { recursive: true, force: true }).catch(() => {});
  }
  if (outsideRoot) {
    await fs.rm(outsideRoot, { recursive: true, force: true }).catch(() => {});
  }
});

describe("isPathAllowed — BA-1 symlink containment hardening", () => {
  it("rejects a to-be-created file under a symlink that points OUTSIDE the allowed root", async () => {
    // This is the BA-1 escape: the parent dir is a symlink outside the
    // allowed root, and the trailing filename does not yet exist. The
    // hardened check must realpath the parent and see it lives outside.
    const target = path.join(symlinkEscape, "newfile.tsx");
    const result = await isPathAllowed(target, [allowedRoot]);
    expect(result).toBeNull();
  });

  it("allows a to-be-created file under a NORMAL (non-symlink) directory inside the allowed root", async () => {
    // Baseline: creation under a real subdirectory must still succeed —
    // the hardened walk must not over-reject.
    const target = path.join(realSubdir, "newfile.tsx");
    const result = await isPathAllowed(target, [allowedRoot]);
    // realpath of the existing subdir + trailing filename.
    expect(result).toBe(path.join(realSubdir, "newfile.tsx"));
  });

  it("allows a to-be-created file under a symlink that points INSIDE the allowed root", async () => {
    // A symlink inside the allowed root pointing to another location
    // inside the allowed root is benign — the realpath resolves to a
    // path under the allowed tree, so containment must hold.
    const target = path.join(symlinkInside, "newfile.tsx");
    const result = await isPathAllowed(target, [allowedRoot]);
    // realpath follows the symlink to the real subdir, so the returned
    // path is anchored there rather than at the link location.
    expect(result).toBe(path.join(realSubdir, "newfile.tsx"));
  });
});
