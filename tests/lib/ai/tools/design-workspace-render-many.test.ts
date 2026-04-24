/**
 * W3.4 — `designWorkspace` tool-layer renderMany validation tests.
 *
 * Locks in the contract between the tool's input schema and the compiler:
 *
 *   1. `validateRenderMany(undefined)` and `validateRenderMany([])` are
 *      both no-ops (the single-render path stays the default).
 *   2. Over-cap (>24 entries) yields a `RENDER_MANY_TOO_MANY` envelope
 *      with `count` + `limit` populated.
 *   3. Non-array input yields `RENDER_MANY_INVALID_PROPS` with index = -1.
 *   4. Missing/null/array `props` on a cell yields
 *      `RENDER_MANY_INVALID_PROPS` with the offending cell index.
 *   5. Non-string `label` / `className` yield `RENDER_MANY_INVALID_PROPS`.
 *   6. The happy path returns normalized `RenderManyCell[]` with
 *      `label` / `className` only present when the caller supplied them
 *      (so the compiler-side encoder doesn't need to special-case
 *      `undefined`).
 *
 * Why test the helper directly:
 *   - The full tool dispatch already has heavy mock coverage in
 *     `design-workspace-port.test.ts` and friends. The renderMany contract
 *     is best exercised at the boundary helper (`validateRenderMany`)
 *     because it's the single chokepoint between the JSON schema and the
 *     compiler's `RenderManyCell[]` input.
 *   - This keeps the test fast (no esbuild, no DB, no fs) and keeps the
 *     blast radius of a tool-dispatch refactor away from the renderMany
 *     contract.
 */

import { describe, expect, it, vi } from "vitest";

// The tool module transitively imports sqlite + drizzle + a dozen other
// heavy pieces. Stub them so the import resolves cleanly under the test
// harness — we never call any of these in this file.
vi.mock("@/lib/db/sqlite-client", () => ({
  db: {},
  getDb: () => ({
    prepare: () => ({ run: () => undefined, get: () => undefined, all: () => [] }),
    exec: () => undefined,
  }),
}));
vi.mock("@/lib/db/queries-sessions", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/lib/workspace/types", () => ({ getWorkspaceInfo: () => null }));
vi.mock("@/lib/vectordb/accessible-sync-folders", () => ({
  getAccessibleSyncFolders: vi.fn(async () => []),
}));
vi.mock("@/lib/ai/tool-registry/logging", () => ({ logToolEvent: vi.fn() }));
vi.mock("@/lib/db/sqlite-character-schema", () => ({ agentSyncFiles: {} }));

// Import AFTER mocks are registered.
const { validateRenderMany } = await import("../../../../lib/ai/tools/design-workspace-tool");
const { RENDER_MANY_MAX_CELLS } = await import("../../../../lib/design/workspace/compiler");

describe("validateRenderMany — W3.4", () => {
  it("undefined input returns ok with no cells (single-render path is the default)", () => {
    const result = validateRenderMany(undefined);
    expect(result).toEqual({ ok: true, cells: [] });
  });

  it("null input returns ok with no cells", () => {
    const result = validateRenderMany(null);
    expect(result).toEqual({ ok: true, cells: [] });
  });

  it("empty array returns ok with no cells", () => {
    const result = validateRenderMany([]);
    expect(result).toEqual({ ok: true, cells: [] });
  });

  it("rejects non-array input with RENDER_MANY_INVALID_PROPS (index = -1)", () => {
    const result = validateRenderMany({ props: { a: 1 } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(-1);
  });

  it("rejects more than RENDER_MANY_MAX_CELLS (24) entries with RENDER_MANY_TOO_MANY", () => {
    const tooMany = Array.from({ length: RENDER_MANY_MAX_CELLS + 1 }, (_, i) => ({
      props: { i },
    }));
    const result = validateRenderMany(tooMany);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_TOO_MANY");
    if (result.error.code !== "RENDER_MANY_TOO_MANY") throw new Error("unreachable");
    expect(result.error.count).toBe(RENDER_MANY_MAX_CELLS + 1);
    expect(result.error.limit).toBe(RENDER_MANY_MAX_CELLS);
    expect(result.error.message).toContain(String(RENDER_MANY_MAX_CELLS));
  });

  it("accepts exactly RENDER_MANY_MAX_CELLS (24) entries (boundary)", () => {
    const exact = Array.from({ length: RENDER_MANY_MAX_CELLS }, (_, i) => ({
      props: { i },
    }));
    const result = validateRenderMany(exact);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.cells).toHaveLength(RENDER_MANY_MAX_CELLS);
  });

  it("rejects a cell missing `props` with RENDER_MANY_INVALID_PROPS + cell index", () => {
    const result = validateRenderMany([{ props: { ok: true } }, { label: "no-props" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(1);
  });

  it("rejects array-typed `props` (typeof [] === 'object' would otherwise sneak through)", () => {
    const result = validateRenderMany([{ props: ["not", "a", "plain", "object"] }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(0);
    expect(result.error.message).toContain("array");
  });

  it("rejects null `props`", () => {
    const result = validateRenderMany([{ props: null }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(0);
  });

  it("rejects primitive `props`", () => {
    const result = validateRenderMany([{ props: "string" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(0);
  });

  it("rejects non-string `label`", () => {
    const result = validateRenderMany([{ props: {}, label: 42 }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(0);
    expect(result.error.message).toContain("label");
  });

  it("rejects non-string `className`", () => {
    const result = validateRenderMany([{ props: {}, className: { foo: "bar" } }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RENDER_MANY_INVALID_PROPS");
    if (result.error.code !== "RENDER_MANY_INVALID_PROPS") throw new Error("unreachable");
    expect(result.error.index).toBe(0);
    expect(result.error.message).toContain("className");
  });

  it("normalizes a happy-path cell list, preserving optional fields only when supplied", () => {
    const result = validateRenderMany([
      { props: { variant: "primary" }, label: "Primary" },
      { props: { variant: "secondary" } },
      { props: { variant: "ghost" }, label: "Ghost", className: "bg-muted p-4" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.cells).toEqual([
      { props: { variant: "primary" }, label: "Primary" },
      { props: { variant: "secondary" } },
      { props: { variant: "ghost" }, label: "Ghost", className: "bg-muted p-4" },
    ]);
    // The middle cell must NOT have a `label` key (vs. `label: undefined`),
    // because the compiler's JSON encoder treats missing keys differently
    // from explicit-undefined keys.
    expect("label" in result.cells[1]).toBe(false);
    expect("className" in result.cells[1]).toBe(false);
  });
});
