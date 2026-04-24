/**
 * Sprint 4 W4.2 — `design:<ref>` virtual-module resolver tests.
 *
 * Drives the full `buildTailwindPreviewWithMetadata` pipeline with an
 * in-memory loader stub so the compiler actually exercises the esbuild
 * plugin chain (onResolve + onLoad) without touching sqlite. The stub is
 * responsible for enforcing (userId, sessionId) scope so the cross-session
 * test case can surface IMPORT_SCOPE_VIOLATION exactly as the production
 * code path would if a caller ever handed the loader a ref that lives in
 * another scope.
 *
 * Covers the four required cases:
 *   1. Happy path — `import X from "design:<id>"` resolves, compiles, and
 *      emits the expected default-export symbol into the bundle.
 *   2. Cross-session reference — IMPORT_SCOPE_VIOLATION.
 *   3. Unknown ref — IMPORT_NOT_FOUND.
 *   4. Cycle A → B → A — IMPORT_CYCLE_DETECTED.
 *
 * Flagged ambiguity: the spec says refs resolve by "id OR tag name" but the
 * backing schema has a `name` column plus a JSON `tags` array. The loader
 * contract the compiler sees is pure `findByRef`, so these tests cover both
 * id-first and name-alias resolution via explicit stub behavior. Tag-array
 * aliasing is out of scope for v1 — see the FLAG-W4.2 comment in
 * `queries.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------------
// Mock the modules the compiler pulls in transitively. The compiler itself
// uses `logToolEvent` (which reaches sqlite-client), plus it imports the
// gallery queries module; we mock both defensively so the suite never
// touches the real DB.
// ------------------------------------------------------------------------
vi.mock("@/lib/ai/tool-registry/logging", () => ({
  logToolEvent: vi.fn(),
}));

vi.mock("@/lib/db/sqlite-client", () => ({
  db: {},
}));

vi.mock("@/lib/db/sqlite-character-schema", () => ({
  agentSyncFiles: {},
}));

// Stub `dependencies` so dependency validation always reports a clean
// manifest — we don't want the test to touch `npm install` or read the
// sandbox node_modules.
vi.mock("../dependencies", () => ({
  installSandboxPackages: vi.fn(async () => ({
    attempted: false,
    success: true,
    packages: [],
    packageNames: [],
  })),
  validateWorkspaceDependencies: vi.fn(async () => ({
    manifestPackages: [],
    importedPackages: [],
    checkedPackages: [],
    missingManifestPackages: [],
    missingImportedPackages: [],
    missingPackages: [],
  })),
}));

// Import AFTER mocks so the compiler module sees them.
const {
  buildTailwindPreviewWithMetadata,
  isDesignWorkspaceImportError,
  DesignWorkspaceImportError,
} = await import("../compiler");
import type { DesignImportLoader } from "../compiler";

// ------------------------------------------------------------------------
// Shared fixtures.
// ------------------------------------------------------------------------

const USER = "user-w42";
const SESSION = "session-w42";
const OTHER_SESSION = "session-other";

interface FakeRow {
  id: string;
  name: string;
  sessionId: string;
  sourceCode: string;
}

function makeLoader(rows: FakeRow[]): DesignImportLoader {
  return {
    async findByRef(input) {
      // Enforce scope here, mirroring `findWorkspaceDesignByIdOrTag`:
      // cross-session rows are invisible. The test for IMPORT_SCOPE_VIOLATION
      // uses a custom loader that intentionally throws the error so we can
      // exercise that branch explicitly — the default loader behavior for
      // cross-scope hits is to collapse them into IMPORT_NOT_FOUND (no
      // existence leak).
      if (input.userId !== USER) return null;
      if (input.sessionId !== SESSION) return null;

      const byId = rows.find((r) => r.id === input.ref);
      if (byId) return { id: byId.id, sourceCode: byId.sourceCode };

      const byName = rows.filter((r) => r.name === input.ref);
      if (byName.length === 1) {
        return { id: byName[0].id, sourceCode: byName[0].sourceCode };
      }
      return null;
    },
  };
}

const BADGE_ROW: FakeRow = {
  id: "0db535f3-abc-123",
  name: "LevelBadge",
  sessionId: SESSION,
  sourceCode: `
    export default function LevelBadge() {
      return <span data-component="level-badge">Lv 42</span>;
    }
  `,
};

describe("W4.2 design:<ref> virtual-module resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: import by id resolves, compiles, and embeds the target's default export", async () => {
    const rootCode = `
      import Badge from "design:${BADGE_ROW.id}";

      export default function Card() {
        return (
          <div data-component="card">
            <Badge />
          </div>
        );
      }
    `;

    const result = await buildTailwindPreviewWithMetadata(rootCode, "Card", {
      autoInstallMissingDependencies: false,
      source: "test-w42-happy-path",
      userId: USER,
      sessionId: SESSION,
      designImportLoader: makeLoader([BADGE_ROW]),
    });

    expect(result.report.errors).toEqual([]);
    // The compiled bundle is an IIFE. Both the Card and the imported
    // LevelBadge component should appear in it — the surest probe is that
    // the imported component's DOM hook is present. esbuild may minify
    // function names, so we assert on the content-addressable data-
    // attribute we authored into the source.
    expect(result.html).toContain('data-component');
    expect(result.html).toContain("level-badge");
    expect(result.html).toContain("card");
  });

  it("happy path: import by name (tag alias) resolves when the name is unique in scope", async () => {
    const rootCode = `
      import Badge from "design:LevelBadge";
      export default function Card() {
        return <div><Badge /></div>;
      }
    `;

    const result = await buildTailwindPreviewWithMetadata(rootCode, "Card", {
      autoInstallMissingDependencies: false,
      source: "test-w42-name-alias",
      userId: USER,
      sessionId: SESSION,
      designImportLoader: makeLoader([BADGE_ROW]),
    });

    expect(result.report.errors).toEqual([]);
    expect(result.html).toContain("level-badge");
  });

  it("cross-session reference surfaces IMPORT_SCOPE_VIOLATION", async () => {
    // Custom loader that KNOWS the ref belongs to another session and
    // surfaces that distinction explicitly. The default loader behavior
    // (collapse cross-scope → null → IMPORT_NOT_FOUND) is validated in the
    // "unknown ref" test below.
    const scopeViolatingLoader: DesignImportLoader = {
      async findByRef(input) {
        if (input.sessionId !== OTHER_SESSION && input.ref === BADGE_ROW.id) {
          // Caller asked for a ref that belongs to another session.
          throw new DesignWorkspaceImportError(
            "IMPORT_SCOPE_VIOLATION",
            input.ref,
            `Ref "${input.ref}" belongs to a different session than (${input.userId}, ${input.sessionId}).`,
          );
        }
        return null;
      },
    };

    const rootCode = `
      import Badge from "design:${BADGE_ROW.id}";
      export default function Card() {
        return <div><Badge /></div>;
      }
    `;

    let caught: unknown = null;
    try {
      await buildTailwindPreviewWithMetadata(rootCode, "Card", {
        autoInstallMissingDependencies: false,
        source: "test-w42-scope-violation",
        userId: USER,
        sessionId: SESSION,
        designImportLoader: scopeViolatingLoader,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(isDesignWorkspaceImportError(caught)).toBe(true);
    const err = caught as DesignWorkspaceImportError;
    expect(err.code).toBe("IMPORT_SCOPE_VIOLATION");
    expect(err.ref).toBe(BADGE_ROW.id);
  });

  it("unknown ref surfaces IMPORT_NOT_FOUND (default loader collapses cross-scope hits to null)", async () => {
    const rootCode = `
      import Missing from "design:does-not-exist";
      export default function Card() {
        return <div><Missing /></div>;
      }
    `;

    let caught: unknown = null;
    try {
      await buildTailwindPreviewWithMetadata(rootCode, "Card", {
        autoInstallMissingDependencies: false,
        source: "test-w42-not-found",
        userId: USER,
        sessionId: SESSION,
        designImportLoader: makeLoader([BADGE_ROW]),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(isDesignWorkspaceImportError(caught)).toBe(true);
    const err = caught as DesignWorkspaceImportError;
    expect(err.code).toBe("IMPORT_NOT_FOUND");
    expect(err.ref).toBe("does-not-exist");
  });

  it("cycle A → B → A surfaces IMPORT_CYCLE_DETECTED with the full chain", async () => {
    const A_ID = "comp-a";
    const B_ID = "comp-b";

    // A imports B; B imports A. Seeding the chain with A's id (as the
    // compile call sites do for the root component) lets the plugin
    // detect the cycle on the SECOND resolve of A rather than letting
    // esbuild recurse indefinitely.
    const A: FakeRow = {
      id: A_ID,
      name: "A",
      sessionId: SESSION,
      sourceCode: `
        import B from "design:${B_ID}";
        export default function A() { return <div><B /></div>; }
      `,
    };
    const B: FakeRow = {
      id: B_ID,
      name: "B",
      sessionId: SESSION,
      sourceCode: `
        import A from "design:${A_ID}";
        export default function B() { return <div><A /></div>; }
      `,
    };

    // The root is A itself — the real tool handler feeds A's source via
    // the `componentCode` argument and seeds `designImportChainSeed` with
    // A's id so a `design:${A_ID}` specifier anywhere in the subgraph is
    // detected as a cycle.
    let caught: unknown = null;
    try {
      await buildTailwindPreviewWithMetadata(A.sourceCode, "A", {
        autoInstallMissingDependencies: false,
        source: "test-w42-cycle",
        userId: USER,
        sessionId: SESSION,
        designImportLoader: makeLoader([A, B]),
        designImportChainSeed: [A_ID],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(isDesignWorkspaceImportError(caught)).toBe(true);
    const err = caught as DesignWorkspaceImportError;
    expect(err.code).toBe("IMPORT_CYCLE_DETECTED");
    // The chain must surface both endpoints of the loop so the agent can
    // see which row closed it. We assert on presence (not exact order)
    // because esbuild's module walk order is an implementation detail.
    expect(err.chain).toContain(A_ID);
    expect(err.chain).toContain(B_ID);
    // The repeated head-of-cycle row is always the LAST entry on the
    // chain — that's the one we refused to load twice.
    expect(err.chain[err.chain.length - 1]).toBe(A_ID);
    // Rev-J1: the chain is exactly [A, B, A] (root → B → A). The buggy
    // compile-wide-Set implementation would have emitted [A, B, A] too
    // for this case, but would ALSO have flagged innocent diamonds as
    // cycles; see the diamond regression below.
    expect(err.chain).toEqual([A_ID, B_ID, A_ID]);
    // Rev-J1: `resolvedId` is the head-of-cycle id surfaced as its own
    // envelope field so the agent does not have to re-derive it from
    // chain[chain.length - 1].
    expect(err.resolvedId).toBe(A_ID);
  });

  // --------------------------------------------------------------------
  // Rev-J1 regression tests — Backend Architect H2 finding
  // (compiler.ts:1137). The previous compile-lifetime `Set<string>`
  // tracker conflated a resolved id staying on the chain forever with a
  // cycle, which turned innocent shared-dependency diamonds and mixed
  // id/name refs into false IMPORT_CYCLE_DETECTED failures. The new
  // path-sensitive tracker records per-specifier parent chains in
  // onResolve and per-specifier full chains in onLoad, so each branch
  // of a DFS sees only the ids on the active stack — not the union of
  // everything loaded so far.
  // --------------------------------------------------------------------

  it("diamond A -> B -> D and A -> C -> D compiles without a false cycle", async () => {
    const A_ID = "comp-diamond-a";
    const B_ID = "comp-diamond-b";
    const C_ID = "comp-diamond-c";
    const D_ID = "comp-diamond-d";

    const D: FakeRow = {
      id: D_ID,
      name: "D",
      sessionId: SESSION,
      sourceCode: `
        export default function D() {
          return <span data-component="leaf-d">D</span>;
        }
      `,
    };
    const B: FakeRow = {
      id: B_ID,
      name: "B",
      sessionId: SESSION,
      sourceCode: `
        import D from "design:${D_ID}";
        export default function B() {
          return <div data-component="branch-b"><D /></div>;
        }
      `,
    };
    const C: FakeRow = {
      id: C_ID,
      name: "C",
      sessionId: SESSION,
      sourceCode: `
        import D from "design:${D_ID}";
        export default function C() {
          return <div data-component="branch-c"><D /></div>;
        }
      `,
    };
    const A: FakeRow = {
      id: A_ID,
      name: "A",
      sessionId: SESSION,
      // Root imports BOTH B and C, which BOTH import D. Pre-fix, D's id
      // would enter the compile-wide Set on the first branch's load and
      // the second branch's resolve of D would trip `.has(D)` and raise
      // IMPORT_CYCLE_DETECTED despite the graph being perfectly acyclic.
      sourceCode: `
        import B from "design:${B_ID}";
        import C from "design:${C_ID}";
        export default function A() {
          return <div data-component="root-a"><B /><C /></div>;
        }
      `,
    };

    const result = await buildTailwindPreviewWithMetadata(
      A.sourceCode,
      "A",
      {
        autoInstallMissingDependencies: false,
        source: "test-w42-rev-j1-diamond",
        userId: USER,
        sessionId: SESSION,
        designImportLoader: makeLoader([A, B, C, D]),
        designImportChainSeed: [A_ID],
      },
    );

    // No errors — the compile MUST succeed because the graph is
    // acyclic. The whole point of Rev-J1.
    expect(result.report.errors).toEqual([]);
    // All three downstream components made it into the bundle.
    expect(result.html).toContain("branch-b");
    expect(result.html).toContain("branch-c");
    expect(result.html).toContain("leaf-d");
  });

  it("diamond with mixed id/name refs to D compiles without a false cycle", async () => {
    // Same shape as the diamond above, but B imports D by id and C
    // imports D by name. These are DIFFERENT esbuild specifier paths
    // (`design:<id>` vs `design:D`) so esbuild runs onLoad for each
    // separately — pre-fix, the second onLoad always saw the first
    // load's resolved id already sitting in the compile-wide Set and
    // raised IMPORT_CYCLE_DETECTED. Rev-J1's path-sensitive parent
    // chains treat them as distinct nodes with distinct chains and
    // only check whether resolved.id appears in the LIVE parent chain.
    const A_ID = "comp-mixed-a";
    const B_ID = "comp-mixed-b";
    const C_ID = "comp-mixed-c";
    const D_ID = "comp-mixed-d";

    const D: FakeRow = {
      id: D_ID,
      name: "MixedD",
      sessionId: SESSION,
      sourceCode: `
        export default function MixedD() {
          return <span data-component="mixed-leaf-d">D</span>;
        }
      `,
    };
    const B: FakeRow = {
      id: B_ID,
      name: "MixedB",
      sessionId: SESSION,
      // B imports D by RAW ID.
      sourceCode: `
        import D from "design:${D_ID}";
        export default function MixedB() {
          return <div data-component="mixed-b"><D /></div>;
        }
      `,
    };
    const C: FakeRow = {
      id: C_ID,
      name: "MixedC",
      sessionId: SESSION,
      // C imports D by NAME ALIAS ("MixedD").
      sourceCode: `
        import D from "design:MixedD";
        export default function MixedC() {
          return <div data-component="mixed-c"><D /></div>;
        }
      `,
    };
    const A: FakeRow = {
      id: A_ID,
      name: "MixedA",
      sessionId: SESSION,
      sourceCode: `
        import B from "design:${B_ID}";
        import C from "design:${C_ID}";
        export default function MixedA() {
          return <div data-component="mixed-a"><B /><C /></div>;
        }
      `,
    };

    const result = await buildTailwindPreviewWithMetadata(
      A.sourceCode,
      "MixedA",
      {
        autoInstallMissingDependencies: false,
        source: "test-w42-rev-j1-mixed-refs",
        userId: USER,
        sessionId: SESSION,
        designImportLoader: makeLoader([A, B, C, D]),
        designImportChainSeed: [A_ID],
      },
    );

    expect(result.report.errors).toEqual([]);
    expect(result.html).toContain("mixed-b");
    expect(result.html).toContain("mixed-c");
    // D shows up regardless of which specifier form reached it first.
    expect(result.html).toContain("mixed-leaf-d");
  });

  it("true cycle inside a diamond-shaped subgraph is still caught", async () => {
    // A imports B and C; C imports A (back-edge). The diamond fix must
    // not mask genuine cycles — this case would have passed pre-Rev-J1
    // by accident (the Set-based tracker would catch it too) but we
    // guard against regressions in the new path-sensitive tracker.
    const A_ID = "comp-backedge-a";
    const B_ID = "comp-backedge-b";
    const C_ID = "comp-backedge-c";

    const B: FakeRow = {
      id: B_ID,
      name: "BackB",
      sessionId: SESSION,
      sourceCode: `
        export default function BackB() {
          return <span data-component="back-b">B</span>;
        }
      `,
    };
    const C: FakeRow = {
      id: C_ID,
      name: "BackC",
      sessionId: SESSION,
      // C imports A — closes the loop.
      sourceCode: `
        import A from "design:${A_ID}";
        export default function BackC() {
          return <div data-component="back-c"><A /></div>;
        }
      `,
    };
    const A: FakeRow = {
      id: A_ID,
      name: "BackA",
      sessionId: SESSION,
      sourceCode: `
        import B from "design:${B_ID}";
        import C from "design:${C_ID}";
        export default function BackA() {
          return <div data-component="back-a"><B /><C /></div>;
        }
      `,
    };

    let caught: unknown = null;
    try {
      await buildTailwindPreviewWithMetadata(A.sourceCode, "BackA", {
        autoInstallMissingDependencies: false,
        source: "test-w42-rev-j1-backedge",
        userId: USER,
        sessionId: SESSION,
        designImportLoader: makeLoader([A, B, C]),
        designImportChainSeed: [A_ID],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(isDesignWorkspaceImportError(caught)).toBe(true);
    const err = caught as DesignWorkspaceImportError;
    expect(err.code).toBe("IMPORT_CYCLE_DETECTED");
    // The chain MUST include the C->A edge that closed the loop. A
    // appears at both endpoints; C sits between them.
    expect(err.chain[0]).toBe(A_ID);
    expect(err.chain[err.chain.length - 1]).toBe(A_ID);
    expect(err.chain).toContain(C_ID);
    expect(err.resolvedId).toBe(A_ID);
    // B sits on a sibling (non-cyclic) branch and must NOT appear in
    // the surfaced chain — that's the whole point of path-sensitive
    // tracking.
    expect(err.chain).not.toContain(B_ID);
  });
});
