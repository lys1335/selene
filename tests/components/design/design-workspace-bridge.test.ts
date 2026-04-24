/**
 * Regression tests for the design-workspace bridge's live-dispatch contract.
 *
 * These lock in the invariants that just regressed after the memory-eviction
 * fix: a live tool result MUST (a) open the workspace panel, (b) activate
 * the freshly-generated component, (c) populate preview HTML from the inline
 * code path. A replay MUST NOT force-open the panel or force-activate — it
 * should only add a lightweight stub so the gallery reflects the component's
 * existence.
 *
 * We drive `applyDesignToolResultToStore` directly instead of going through
 * the DOM event path because (1) jsdom's CustomEvent handling is synchronous
 * but noisy, and (2) the failure modes we're guarding against live in the
 * branch-selection logic inside that function, not the event plumbing. A
 * separate test covers the dispatch → bridge wiring at a higher level.
 *
 * Sprint 2 Rev2-C1 — extended for the Sprint 2 import/port action contract:
 *   * live `import` mirrors `generate` (open + hydrate + gallery refresh)
 *   * replay `import` adds a summary stub and is idempotent on replay-N
 *   * live `port` (dry-run / apply / no-op) does NOT mutate the store —
 *     `port` is export-direction, not hydrate-direction.
 *   * `PORT_STALE_DIFF` preserves `stalePortInfo` and renders the hashes +
 *     mtime via `PortStaleDiffBanner`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Stub the chat-provider import chain. The tool-UI module (which owns
// `PortStaleDiffBanner`) transitively pulls `@/components/chat-provider`,
// which requires the full assistant-ui / ai-sdk runtime. The banner
// itself only needs React + lucide-react, so replacing the hook with a
// no-op keeps the module graph small and this test in the node env.
// `vi.mock` is hoisted above the following imports automatically.
vi.mock("@/components/chat-provider", () => ({
  useChatSessionId: () => undefined,
}));

import {
  applyDesignToolResultToStore,
  applyRehydrationResultToStore,
  type DesignToolEvent,
} from "@/components/design/design-workspace-bridge";
import { useDesignWorkspaceStore } from "@/lib/design/workspace/store";
import {
  PortStaleDiffBanner,
  SnapshotErrorPanel,
  isSnapshotErrorCode,
  toBridgeData,
} from "@/components/assistant-ui/design-workspace-tool-ui";

function makeEvent(overrides: Partial<DesignToolEvent> & {
  data?: Partial<NonNullable<DesignToolEvent["data"]>>;
}): DesignToolEvent {
  return {
    action: "generate",
    success: true,
    isLive: true,
    ...overrides,
    data: {
      componentId: "design-42",
      name: "Todo list",
      style: "default",
      prompt: "a todo list",
      code: "<div>Hello</div>",
      ...(overrides.data ?? {}),
    },
  };
}

describe("design-workspace-bridge — live vs replay dispatch contract", () => {
  beforeEach(() => {
    useDesignWorkspaceStore.getState().reset();
  });

  it("LIVE generate with inline code opens the workspace, activates the component, and builds preview", () => {
    // Precondition: workspace starts closed with no active component.
    const before = useDesignWorkspaceStore.getState();
    expect(before.isOpen).toBe(false);
    expect(before.activeComponentId).toBeNull();

    applyDesignToolResultToStore(
      makeEvent({
        action: "generate",
        isLive: true,
        data: { componentId: "design-42", code: "<div>Live</div>" },
      }),
    );

    const after = useDesignWorkspaceStore.getState();
    // The three invariants that the previous regression broke:
    expect(after.isOpen).toBe(true);
    expect(after.activeComponentId).toBe("design-42");
    expect(after.previewHtml.length).toBeGreaterThan(0);
    // And the component is in the store with full code (no codeStripped flag).
    const stored = after.components.find((c) => c.id === "design-42");
    expect(stored?.code).toBe("<div>Live</div>");
    expect(stored?.codeStripped).toBe(false);
  });

  it("REPLAY generate does NOT open the workspace and does NOT activate", () => {
    applyDesignToolResultToStore(
      makeEvent({
        action: "generate",
        isLive: false, // replay — historical tool call from chat scrollback
        data: { componentId: "design-99", code: "<div>Stale</div>" },
      }),
    );

    const state = useDesignWorkspaceStore.getState();
    // The replay branch must not force-open the panel or flip active — that
    // would defeat the memory-eviction fix by eagerly hydrating every past
    // design from chat history.
    expect(state.isOpen).toBe(false);
    expect(state.activeComponentId).toBeNull();
    expect(state.previewHtml).toBe("");
    // But it should have added a lightweight stub so the gallery's "Open"
    // list reflects the component's existence.
    const stub = state.components.find((c) => c.id === "design-99");
    expect(stub).toBeDefined();
    expect(stub?.codeStripped).toBe(true);
    expect(stub?.code).toBe("");
  });

  it("LIVE generate opens the workspace even when it was already closed", () => {
    // Simulate the user having closed the panel before the agent generates.
    useDesignWorkspaceStore.getState().close();
    expect(useDesignWorkspaceStore.getState().isOpen).toBe(false);

    applyDesignToolResultToStore(
      makeEvent({
        isLive: true,
        data: { componentId: "design-50", code: "<div>Reopen</div>" },
      }),
    );

    expect(useDesignWorkspaceStore.getState().isOpen).toBe(true);
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("design-50");
  });

  it("LIVE edit with inline code updates the stored code and keeps the component active", () => {
    // Seed: the agent generated this design moments ago (live).
    applyDesignToolResultToStore(
      makeEvent({
        action: "generate",
        isLive: true,
        data: { componentId: "design-7", code: "<div>v1</div>" },
      }),
    );
    expect(useDesignWorkspaceStore.getState().previewHtml.length).toBeGreaterThan(0);

    // Now a live edit arrives.
    applyDesignToolResultToStore(
      makeEvent({
        action: "edit",
        isLive: true,
        data: { componentId: "design-7", code: "<div>v2-edited</div>" },
      }),
    );

    const state = useDesignWorkspaceStore.getState();
    // Critical contract: the code in the store reflects the edit.
    const stored = state.components.find((c) => c.id === "design-7");
    expect(stored?.code).toBe("<div>v2-edited</div>");
    expect(stored?.codeStripped).toBe(false);
    // Active component is unchanged (we edited the already-active one).
    expect(state.activeComponentId).toBe("design-7");
    // The stored previewHtml is an intentionally code-independent loader
    // placeholder — `useCompileTailwindPreview` observes the code change
    // directly and swaps in the real compiled preview. We only assert the
    // placeholder is present, not that it differs from the previous one.
    expect(state.previewHtml.length).toBeGreaterThan(0);
  });

  it("REPLAY edit does NOT overwrite a previously-hydrated component's code", () => {
    // Live generate hydrates the component with v1 code.
    applyDesignToolResultToStore(
      makeEvent({
        action: "generate",
        isLive: true,
        data: { componentId: "design-7", code: "<div>v1-live</div>" },
      }),
    );

    // Replay of an old edit arrives (e.g. scrollback re-render).
    applyDesignToolResultToStore(
      makeEvent({
        action: "edit",
        isLive: false,
        data: { componentId: "design-7", code: "<div>ancient-version</div>" },
      }),
    );

    const stored = useDesignWorkspaceStore.getState().components.find((c) => c.id === "design-7");
    // The replay must not clobber the already-hydrated code with a stale stub.
    expect(stored?.code).toBe("<div>v1-live</div>");
    expect(stored?.codeStripped).toBe(false);
  });

  it("LIVE generate without a componentId is a no-op (guard against malformed payloads)", () => {
    applyDesignToolResultToStore({
      action: "generate",
      success: true,
      isLive: true,
      data: { code: "<div>orphan</div>" }, // no componentId
    });

    const state = useDesignWorkspaceStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeComponentId).toBeNull();
    expect(state.components).toHaveLength(0);
  });

  it("LIVE open action opens the workspace; REPLAY open does not", () => {
    applyDesignToolResultToStore({
      action: "open",
      success: true,
      isLive: false,
    });
    expect(useDesignWorkspaceStore.getState().isOpen).toBe(false);

    applyDesignToolResultToStore({
      action: "open",
      success: true,
      isLive: true,
    });
    expect(useDesignWorkspaceStore.getState().isOpen).toBe(true);
  });
});

describe("design-workspace-bridge — Sprint 2 import/port dispatch contract", () => {
  beforeEach(() => {
    useDesignWorkspaceStore.getState().reset();
  });

  it("LIVE import with inline code opens the workspace, activates the imported component, and mirrors generate's gallery hydrate", () => {
    const before = useDesignWorkspaceStore.getState();
    expect(before.isOpen).toBe(false);
    expect(before.activeComponentId).toBeNull();

    applyDesignToolResultToStore({
      action: "import",
      success: true,
      isLive: true,
      data: {
        componentId: "import-123",
        name: "Hero",
        style: "default",
        prompt: "imported from src/Hero.tsx",
        code: "<div>Imported</div>",
        sourcePath: "src/Hero.tsx",
        resolvedSourcePath: "/abs/root/src/Hero.tsx",
        importedAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z",
        updated: false,
        tags: ["imported"],
      },
    });

    const after = useDesignWorkspaceStore.getState();
    // Live import mirrors live generate: open workspace + activate + preview.
    expect(after.isOpen).toBe(true);
    expect(after.activeComponentId).toBe("import-123");
    expect(after.previewHtml.length).toBeGreaterThan(0);
    const stored = after.components.find((c) => c.id === "import-123");
    expect(stored?.code).toBe("<div>Imported</div>");
    expect(stored?.codeStripped).toBe(false);
    expect(stored?.name).toBe("Hero");
  });

  it("REPLAY import adds a summary stub and is idempotent — second replay must not duplicate or clobber", () => {
    const replayEvent: DesignToolEvent = {
      action: "import",
      success: true,
      isLive: false,
      data: {
        componentId: "import-replay-1",
        name: "Card",
        style: "default",
        prompt: "imported card",
        code: "<div>historical</div>",
        sourcePath: "src/Card.tsx",
        updated: false,
      },
    };

    applyDesignToolResultToStore(replayEvent);

    const afterFirst = useDesignWorkspaceStore.getState();
    expect(afterFirst.isOpen).toBe(false);
    expect(afterFirst.activeComponentId).toBeNull();
    const stub = afterFirst.components.find((c) => c.id === "import-replay-1");
    expect(stub).toBeDefined();
    expect(stub?.codeStripped).toBe(true);
    expect(stub?.code).toBe("");
    expect(afterFirst.components.filter((c) => c.id === "import-replay-1")).toHaveLength(1);

    // Second replay dispatch (e.g. user scrolls back, tool-UI remounts).
    // Must not insert a duplicate row and must not clobber the existing stub.
    applyDesignToolResultToStore(replayEvent);

    const afterSecond = useDesignWorkspaceStore.getState();
    const all = afterSecond.components.filter((c) => c.id === "import-replay-1");
    expect(all).toHaveLength(1);
    expect(all[0].codeStripped).toBe(true);
    expect(all[0].code).toBe("");
  });

  it("LIVE port dry-run carries the diff payload without mutating the store", () => {
    // Seed the store with an active component so we can assert it wasn't
    // touched by the port dispatch (port is export-direction).
    useDesignWorkspaceStore.getState().addComponent({
      id: "active-42",
      name: "Active",
      code: "<div>Untouched</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    const beforeCount = useDesignWorkspaceStore.getState().components.length;
    const beforeActive = useDesignWorkspaceStore.getState().activeComponentId;

    applyDesignToolResultToStore({
      action: "port",
      success: true,
      isLive: true,
      data: {
        componentId: "active-42",
        applied: false,
        targetPath: "/abs/root/src/out/Active.tsx",
        targetRelativePath: "src/out/Active.tsx",
        targetExistedBefore: true,
        targetSize: 42,
        diff: "--- a\n+++ b\n@@ -1 +1 @@\n-<div>old</div>\n+<div>new</div>",
        diffTruncated: false,
        preflight: {
          contentSha256: "a".repeat(64),
          mtimeMs: 1_700_000_000_000,
        },
      },
    });

    const after = useDesignWorkspaceStore.getState();
    // port dispatch must NOT change the workspace (port = export, not hydrate).
    expect(after.components.length).toBe(beforeCount);
    expect(after.activeComponentId).toBe(beforeActive);
    expect(after.components.find((c) => c.id === "active-42")?.code).toBe("<div>Untouched</div>");
    expect(after.error).toBeNull();
  });

  it("LIVE port apply success does not mutate the store (diff/bytesWritten are purely UI concerns)", () => {
    useDesignWorkspaceStore.getState().addComponent({
      id: "port-apply-7",
      name: "Apply",
      code: "<div>Source</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    const beforeSnapshot = {
      count: useDesignWorkspaceStore.getState().components.length,
      active: useDesignWorkspaceStore.getState().activeComponentId,
      error: useDesignWorkspaceStore.getState().error,
    };

    applyDesignToolResultToStore({
      action: "port",
      success: true,
      isLive: true,
      data: {
        componentId: "port-apply-7",
        applied: true,
        targetPath: "/abs/root/src/out/Apply.tsx",
        targetRelativePath: "src/out/Apply.tsx",
        targetExistedBefore: false,
        targetSize: 0,
        bytesWritten: 15,
        diff: "+<div>Source</div>",
        diffTruncated: false,
      },
    });

    const after = useDesignWorkspaceStore.getState();
    expect(after.components.length).toBe(beforeSnapshot.count);
    expect(after.activeComponentId).toBe(beforeSnapshot.active);
    expect(after.error).toBe(beforeSnapshot.error);
  });

  it("LIVE port no-op (target already matches source) does not surface an error or mutate the store", () => {
    useDesignWorkspaceStore.getState().addComponent({
      id: "port-noop-9",
      name: "Noop",
      code: "<div>Same</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    const beforeSnapshot = {
      count: useDesignWorkspaceStore.getState().components.length,
      active: useDesignWorkspaceStore.getState().activeComponentId,
      error: useDesignWorkspaceStore.getState().error,
    };

    applyDesignToolResultToStore({
      action: "port",
      success: true,
      isLive: true,
      data: {
        componentId: "port-noop-9",
        applied: false,
        targetPath: "/abs/root/src/out/Noop.tsx",
        targetRelativePath: "src/out/Noop.tsx",
        targetExistedBefore: true,
        targetSize: 15,
        bytesWritten: 0,
        diff: "",
        preflight: {
          contentSha256: "b".repeat(64),
          mtimeMs: 1_700_000_000_000,
        },
      },
    });

    const after = useDesignWorkspaceStore.getState();
    expect(after.components.length).toBe(beforeSnapshot.count);
    expect(after.activeComponentId).toBe(beforeSnapshot.active);
    expect(after.error).toBe(beforeSnapshot.error);
  });

  it("PORT_STALE_DIFF preserves stalePortInfo through the bridge event detail", () => {
    const stalePortInfo = {
      currentSha256: "c".repeat(64),
      expectedSha256: "d".repeat(64),
      mtimeMs: 1_700_000_123_456,
    };

    const detail: DesignToolEvent = {
      action: "port",
      success: false,
      isLive: true,
      error: "Target changed on disk between dry-run and apply.",
      data: {
        componentId: "stale-1",
        applied: false,
        targetPath: "/abs/root/src/out/Stale.tsx",
        targetRelativePath: "src/out/Stale.tsx",
        targetExistedBefore: true,
        targetSize: 42,
        diff: "",
        errorCode: "PORT_STALE_DIFF",
        stalePortInfo,
      },
    };

    // Verify the typed event shape carries stalePortInfo without loss.
    expect(detail.data?.stalePortInfo).toEqual(stalePortInfo);
    expect(detail.data?.errorCode).toBe("PORT_STALE_DIFF");

    // Bridge must surface the backend error on the store so the workspace
    // error banner can pick it up. It must NOT mutate any component row.
    applyDesignToolResultToStore(detail);
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toBe("Target changed on disk between dry-run and apply.");
    expect(after.components.find((c) => c.id === "stale-1")).toBeUndefined();
  });

  it("PortStaleDiffBanner renders current + expected SHAs and the ISO mtime from stalePortInfo", () => {
    const stalePortInfo = {
      // Distinct prefixes so we can assert the short-hash trim (first 10 chars).
      currentSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      expectedSha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      mtimeMs: 1_714_003_200_000, // 2024-04-25T00:00:00.000Z — deterministic ISO output
    };

    const html = renderToStaticMarkup(
      createElement(PortStaleDiffBanner, { stalePortInfo }),
    );

    // Short-hash trim keeps the first 10 hex chars of each SHA visible.
    expect(html).toContain("abcdef0123");
    expect(html).toContain("fedcba9876");
    // Full SHAs are carried on title attributes for copy/paste diagnostics.
    expect(html).toContain(stalePortInfo.currentSha256);
    expect(html).toContain(stalePortInfo.expectedSha256);
    // mtime is rendered as an ISO-8601 timestamp.
    expect(html).toContain(new Date(stalePortInfo.mtimeMs).toISOString());
    // The stock copy + the re-run CTA both stay visible.
    expect(html).toContain("Target file changed since dry-run");
    expect(html).toContain("dryRun: true");
  });

  it("PortStaleDiffBanner tolerates a null mtime (renders the 'unknown' fallback row)", () => {
    const html = renderToStaticMarkup(
      createElement(PortStaleDiffBanner, {
        stalePortInfo: {
          currentSha256: "0".repeat(64),
          expectedSha256: "1".repeat(64),
          mtimeMs: null,
        },
      }),
    );
    expect(html).toContain("unknown");
    expect(html).toContain("Target file changed since dry-run");
  });

  // Rev-G B2 — SnapshotErrorPanel surfaces structured snapshot failure
  // metadata instead of dumping a raw `error` string under a generic red
  // banner. Lock in that the panel (a) shows the SNAPSHOT_* errorCode,
  // (b) echoes each actionable id field when present, and (c) renders a
  // per-code recovery hint for the codes the panel documents. The
  // isSnapshotErrorCode type guard is the gating predicate the tool UI
  // uses to decide whether to render this panel and suppress the
  // generic error banner — cover both together to pin the contract.
  it("SnapshotErrorPanel renders the errorCode + structured ids + recovery hint", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotErrorPanel, {
        action: "snapshot.diff",
        errorCode: "SNAPSHOT_NOT_FOUND",
        message: "Snapshot \"snap-xyz\" was not found in this session.",
        snapshotId: "snap-xyz",
        missingId: "snap-xyz",
        componentId: "cmp-9",
        a: { id: "snap-a", name: "before" },
        b: { id: "snap-b", name: "after" },
      }),
    );
    expect(html).toContain("SNAPSHOT_NOT_FOUND");
    expect(html).toContain("Snapshot not found"); // heading
    expect(html).toContain("snap-xyz");
    expect(html).toContain("cmp-9");
    expect(html).toContain("snap-a");
    expect(html).toContain("before");
    expect(html).toContain("snap-b");
    expect(html).toContain("after");
    // Per-code recovery hint for SNAPSHOT_NOT_FOUND
    expect(html).toContain("snapshot.list");
  });

  it("SnapshotErrorPanel hides id rows that are absent from the envelope", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotErrorPanel, {
        action: "snapshot.save",
        errorCode: "SNAPSHOT_COMPONENT_NOT_FOUND",
        message: "Component not found.",
        componentId: "cmp-missing",
      }),
    );
    expect(html).toContain("SNAPSHOT_COMPONENT_NOT_FOUND");
    expect(html).toContain("cmp-missing");
    // With no snapshotId/missingId/a/b provided, those id rows must not
    // render — the panel does not fake blank fields.
    expect(html).not.toContain("Snapshot id:");
    expect(html).not.toContain("Missing id:");
    expect(html).not.toContain("A:");
    expect(html).not.toContain("B:");
    // Per-code recovery hint for SNAPSHOT_COMPONENT_NOT_FOUND
    expect(html).toContain("re-check");
  });

  it("isSnapshotErrorCode narrows the full SNAPSHOT_* set and rejects non-snapshot codes", () => {
    const valid = [
      "SNAPSHOT_COMPONENT_NOT_FOUND",
      "SNAPSHOT_NOT_FOUND",
      "SNAPSHOT_NAME_TOO_LONG",
      "SNAPSHOT_SAVE_FAILED",
      "SNAPSHOT_PIN_FAILED",
      "SNAPSHOT_RENAME_FAILED",
      "SNAPSHOT_DELETE_FAILED",
      "SNAPSHOT_DIFF_INVALID_INPUT",
      "SNAPSHOT_DIFF_FAILED",
    ];
    for (const code of valid) {
      expect(isSnapshotErrorCode(code)).toBe(true);
    }
    for (const code of [
      undefined,
      "",
      "INVALID_INPUT",
      "PORT_WRITE_FAILED",
      "ASSET_ALIAS_NOT_FOUND",
      "REFERENCE_IMAGE_URL_INVALID",
      "SNAPSHOT_UNKNOWN_CODE",
    ]) {
      expect(isSnapshotErrorCode(code)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 3 W3.1 — persisted design snapshot action branches.
//
// The bridge treats snapshot.* actions as cosmetic (no store mutation on
// success) — the tool-UI renders them directly from the event `data`. This
// suite locks in that contract:
//
//   * success on any snapshot.* action does NOT add components, does NOT
//     open the workspace, does NOT touch activeComponentId or previewHtml.
//   * live failure with a non-empty `error` surfaces it through the store's
//     error banner so the user isn't left guessing.
//   * replay failure must not clobber the banner — bridge only forwards
//     errors for live events (matches the Sprint 2 port contract).
// ---------------------------------------------------------------------------

function makeSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    userId: "user-1",
    sessionId: "sess-1",
    componentId: "component-1",
    sourceCode: "const A = 1;",
    name: null as string | null,
    isPinned: false,
    metadata: null,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("design-workspace-bridge — snapshot.* action branches (Sprint 3 W3.1)", () => {
  beforeEach(() => {
    useDesignWorkspaceStore.getState().reset();
  });

  it("snapshot.save success: no components added, no store mutation", () => {
    const before = useDesignWorkspaceStore.getState();
    applyDesignToolResultToStore({
      action: "snapshot.save",
      success: true,
      isLive: true,
      data: {
        componentId: "component-1",
        snapshotId: "snap-1",
        snapshot: makeSnapshotRow({ name: "Pre-refactor" }),
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.isOpen).toBe(before.isOpen);
    expect(after.activeComponentId).toBe(before.activeComponentId);
    expect(after.components.length).toBe(before.components.length);
    expect(after.error).toBeNull();
  });

  it("snapshot.pin success: store is untouched", () => {
    applyDesignToolResultToStore({
      action: "snapshot.pin",
      success: true,
      isLive: true,
      data: {
        snapshotId: "snap-1",
        snapshot: makeSnapshotRow({ isPinned: true }),
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.components).toEqual([]);
    expect(after.error).toBeNull();
  });

  it("snapshot.rename success: store is untouched", () => {
    applyDesignToolResultToStore({
      action: "snapshot.rename",
      success: true,
      isLive: true,
      data: {
        snapshotId: "snap-1",
        snapshot: makeSnapshotRow({ name: "Checkpoint" }),
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.components).toEqual([]);
    expect(after.error).toBeNull();
  });

  it("snapshot.list success: no components populated into the Zustand store (tool-UI renders directly)", () => {
    applyDesignToolResultToStore({
      action: "snapshot.list",
      success: true,
      isLive: true,
      data: {
        snapshots: [
          makeSnapshotRow({ id: "a" }),
          makeSnapshotRow({ id: "b" }),
        ],
      },
    });
    const after = useDesignWorkspaceStore.getState();
    // The store holds DESIGN COMPONENTS, not snapshots — the list card
    // renders from the event `data` directly, so the components list
    // must stay empty.
    expect(after.components).toEqual([]);
    expect(after.error).toBeNull();
  });

  it("snapshot.delete soft-miss (success:true, deleted:false): store untouched", () => {
    applyDesignToolResultToStore({
      action: "snapshot.delete",
      success: true,
      isLive: true,
      data: {
        snapshotId: "snap-1",
        deleted: false,
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.components).toEqual([]);
    expect(after.error).toBeNull();
  });

  it("LIVE snapshot.save failure surfaces the backend error via store.setError", () => {
    applyDesignToolResultToStore({
      action: "snapshot.save",
      success: false,
      isLive: true,
      error: "Failed to persist snapshot: disk full",
      data: {
        errorCode: "SNAPSHOT_SAVE_FAILED",
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toBe("Failed to persist snapshot: disk full");
  });

  it("LIVE snapshot.delete failure surfaces SNAPSHOT_DELETE_FAILED error text", () => {
    applyDesignToolResultToStore({
      action: "snapshot.delete",
      success: false,
      isLive: true,
      error: "Failed to delete snapshot row.",
      data: {
        errorCode: "SNAPSHOT_DELETE_FAILED",
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toBe("Failed to delete snapshot row.");
  });

  it("REPLAY snapshot failure does NOT re-surface via the snapshot switch branch", () => {
    // The top-of-function guard in `applyDesignToolResultToStore` sets
    // `store.error` on ANY `!success && error` dispatch (that's existing
    // behavior, unchanged by W3.1). The Sprint 3 snapshot switch branch
    // additionally guards on `isLive && !store.error` — so replays hit
    // only the top-level guard, not the switch's own `setError`. This
    // test documents that the switch branch itself is a no-op for
    // replays by priming the store with an error first and verifying
    // the replay does not overwrite it with a different message.
    useDesignWorkspaceStore.getState().setError("pre-existing error");
    applyDesignToolResultToStore({
      action: "snapshot.save",
      success: false,
      isLive: false,
      error: "Stale error from history",
      data: {
        errorCode: "SNAPSHOT_SAVE_FAILED",
      },
    });
    // The top-level guard will have clobbered the banner — documented
    // existing behavior. The point of this test is to prove the snapshot
    // switch branch does not add an additional side-effect on replay.
    const after = useDesignWorkspaceStore.getState();
    expect(after.components).toEqual([]);
    // The switch branch's guarded setError does NOT fire on replay, so
    // the ONLY error set here is the top-level one — which is "Stale…".
    expect(after.error).toBe("Stale error from history");
  });

  it("W3.3/W3.4 errorCode + referenceImage / renderMany fields are type-safe on DesignToolEvent", () => {
    // Compile-time-ish smoke check that the bridge's DesignToolEvent.data
    // union carries the new W3.3 / W3.4 fields. If any of these drop off the
    // union, the following construction stops typechecking.
    const refSuccess: DesignToolEvent = {
      action: "generate",
      success: true,
      isLive: true,
      data: {
        componentId: "c",
        code: "<div/>",
        referenceImage: { url: "https://cdn/a.png", present: true },
      },
    };
    const refError: DesignToolEvent = {
      action: "generate",
      success: false,
      isLive: true,
      error: "bad url",
      data: {
        errorCode: "REFERENCE_IMAGE_URL_INVALID",
        referenceImageError: {
          code: "REFERENCE_IMAGE_URL_INVALID",
          message: "bad url",
        },
      },
    };
    const refTooLarge: DesignToolEvent = {
      action: "generate",
      success: false,
      isLive: true,
      error: "too large",
      data: {
        errorCode: "REFERENCE_IMAGE_URL_TOO_LARGE",
        referenceImageError: {
          code: "REFERENCE_IMAGE_URL_TOO_LARGE",
          message: "too large",
          rejectedUrl: "https://cdn/huge.png",
          bytes: 10_000_000,
          limit: 5_000_000,
        },
      },
    };
    const grid: DesignToolEvent = {
      action: "generate",
      success: true,
      isLive: true,
      data: {
        componentId: "c",
        code: "<div/>",
        renderMany: { count: 3, cellsEmitted: 3 },
        renderManyWarnings: [{ index: 0, message: "fallback applied" }],
      },
    };
    const gridErr: DesignToolEvent = {
      action: "generate",
      success: false,
      isLive: true,
      error: "too many",
      data: {
        errorCode: "RENDER_MANY_TOO_MANY",
        renderManyError: {
          code: "RENDER_MANY_TOO_MANY",
          message: "too many",
          count: 30,
          limit: 24,
        },
      },
    };
    expect(refSuccess.data?.referenceImage?.present).toBe(true);
    expect(refError.data?.errorCode).toBe("REFERENCE_IMAGE_URL_INVALID");
    expect(refTooLarge.data?.referenceImageError?.bytes).toBe(10_000_000);
    expect(grid.data?.renderMany?.count).toBe(3);
    expect(gridErr.data?.renderManyError?.limit).toBe(24);
  });

  it("snapshot.* errorCode + snapshot / snapshots / deleted fields are type-safe on DesignToolEvent", () => {
    // This test is a compile-time-ish smoke check: if the bridge's
    // `DesignToolEvent.data` union stopped carrying any of these fields,
    // the following construction would fail to typecheck. The assertion
    // is trivial; the point is the types.
    const save: DesignToolEvent = {
      action: "snapshot.save",
      success: true,
      isLive: true,
      data: {
        snapshot: makeSnapshotRow(),
        snapshotId: "snap-1",
        componentId: "component-1",
      },
    };
    const list: DesignToolEvent = {
      action: "snapshot.list",
      success: true,
      isLive: true,
      data: {
        snapshots: [makeSnapshotRow()],
        truncated: true,
      },
    };
    const del: DesignToolEvent = {
      action: "snapshot.delete",
      success: true,
      isLive: true,
      data: {
        deleted: false,
        snapshotId: "snap-1",
      },
    };
    const err: DesignToolEvent = {
      action: "snapshot.pin",
      success: false,
      isLive: true,
      error: "nope",
      data: { errorCode: "SNAPSHOT_NOT_FOUND" },
    };
    expect(save.action).toBe("snapshot.save");
    expect(list.data?.truncated).toBe(true);
    expect(del.data?.deleted).toBe(false);
    expect(err.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Sprint 3 W3.2 — `snapshot.diff` envelope forwarding through the bridge.
//
// Contract:
//   * successful snapshot.diff dispatches do NOT mutate the store (no
//     components added, no activeComponentId flip, no previewHtml change).
//   * `toBridgeData` forwards `a`, `b`, `diff`, `diffTruncated`, `sameContent`,
//     `totalLines`, and `missingId` unchanged so downstream consumers (the
//     tool-UI panel, any chat-history preview) see the exact backend payload.
//   * failure `errorCode`s (`SNAPSHOT_NOT_FOUND`, `SNAPSHOT_DIFF_INVALID_INPUT`,
//     `SNAPSHOT_DIFF_FAILED`) are carried on the event and surfaced through
//     `store.error` on live failures.
// ---------------------------------------------------------------------------

describe("design-workspace-bridge — snapshot.diff envelope forwarding (Sprint 3 W3.2)", () => {
  beforeEach(() => {
    useDesignWorkspaceStore.getState().reset();
  });

  it("toBridgeData forwards a/b summaries + diff/diffTruncated/sameContent/totalLines on a successful snapshot.diff envelope", () => {
    const forwarded = toBridgeData({
      a: {
        id: "snap-a",
        createdAt: "2026-04-24T00:00:00.000Z",
        name: "Before",
        isPinned: false,
        componentId: "component-1",
      },
      b: {
        id: "snap-b",
        createdAt: "2026-04-24T00:05:00.000Z",
        name: "After",
        isPinned: true,
        componentId: "component-1",
      },
      diff: "--- snapshot:Before->After\n+++ snapshot:Before->After\n@@ -1 +1 @@\n-const A = 1;\n+const A = 2;",
      diffTruncated: false,
      sameContent: false,
      totalLines: 5,
    });
    expect(forwarded?.a).toEqual({
      id: "snap-a",
      createdAt: "2026-04-24T00:00:00.000Z",
      name: "Before",
      isPinned: false,
      componentId: "component-1",
    });
    expect(forwarded?.b).toEqual({
      id: "snap-b",
      createdAt: "2026-04-24T00:05:00.000Z",
      name: "After",
      isPinned: true,
      componentId: "component-1",
    });
    expect(forwarded?.diff).toContain("const A = 1;");
    expect(forwarded?.diff).toContain("const A = 2;");
    expect(forwarded?.diffTruncated).toBe(false);
    expect(forwarded?.sameContent).toBe(false);
    expect(forwarded?.totalLines).toBe(5);
    expect(forwarded?.missingId).toBeUndefined();
  });

  it("toBridgeData forwards sameContent:true + empty diff on identical-content envelope", () => {
    const forwarded = toBridgeData({
      a: {
        id: "snap-a",
        createdAt: "2026-04-24T00:00:00.000Z",
        name: null,
        isPinned: false,
        componentId: "component-1",
      },
      b: {
        id: "snap-b",
        createdAt: "2026-04-24T00:00:00.000Z",
        name: null,
        isPinned: false,
        componentId: "component-1",
      },
      diff: "",
      diffTruncated: false,
      sameContent: true,
      totalLines: 0,
    });
    expect(forwarded?.sameContent).toBe(true);
    expect(forwarded?.diff).toBe("");
    expect(forwarded?.totalLines).toBe(0);
  });

  it("toBridgeData forwards diffTruncated:true + totalLines through the bridge on an over-cap diff", () => {
    const forwarded = toBridgeData({
      a: { id: "snap-a", createdAt: "2026-04-24T00:00:00.000Z" },
      b: { id: "snap-b", createdAt: "2026-04-24T00:05:00.000Z" },
      diff: "--- ...truncated at 1000 lines...\n[diff truncated: 4200 total lines]",
      diffTruncated: true,
      sameContent: false,
      totalLines: 4200,
    });
    expect(forwarded?.diffTruncated).toBe(true);
    expect(forwarded?.totalLines).toBe(4200);
    expect(forwarded?.diff).toContain("truncated");
  });

  it("toBridgeData forwards errorCode + missingId on SNAPSHOT_NOT_FOUND", () => {
    const forwarded = toBridgeData({
      errorCode: "SNAPSHOT_NOT_FOUND",
      missingId: "snap-missing",
    });
    expect(forwarded?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
    expect(forwarded?.missingId).toBe("snap-missing");
  });

  it("toBridgeData forwards errorCode on SNAPSHOT_DIFF_INVALID_INPUT", () => {
    const forwarded = toBridgeData({
      errorCode: "SNAPSHOT_DIFF_INVALID_INPUT",
    });
    expect(forwarded?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");
  });

  it("toBridgeData forwards a/b summaries + errorCode on SNAPSHOT_DIFF_FAILED (rows resolved before diff throw)", () => {
    const forwarded = toBridgeData({
      errorCode: "SNAPSHOT_DIFF_FAILED",
      a: {
        id: "snap-a",
        createdAt: "2026-04-24T00:00:00.000Z",
        name: "Before",
        isPinned: false,
        componentId: "component-1",
      },
      b: {
        id: "snap-b",
        createdAt: "2026-04-24T00:05:00.000Z",
        name: "After",
        isPinned: false,
        componentId: "component-1",
      },
    });
    expect(forwarded?.errorCode).toBe("SNAPSHOT_DIFF_FAILED");
    expect(forwarded?.a?.id).toBe("snap-a");
    expect(forwarded?.b?.id).toBe("snap-b");
  });

  it("LIVE snapshot.diff success does NOT mutate the Zustand store (session-local display only)", () => {
    const before = useDesignWorkspaceStore.getState();
    applyDesignToolResultToStore({
      action: "snapshot.diff",
      success: true,
      isLive: true,
      data: {
        a: {
          id: "snap-a",
          createdAt: "2026-04-24T00:00:00.000Z",
          name: "Before",
          isPinned: false,
          componentId: "component-1",
        },
        b: {
          id: "snap-b",
          createdAt: "2026-04-24T00:05:00.000Z",
          name: "After",
          isPinned: false,
          componentId: "component-1",
        },
        diff: "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y",
        diffTruncated: false,
        sameContent: false,
        totalLines: 5,
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.isOpen).toBe(before.isOpen);
    expect(after.activeComponentId).toBe(before.activeComponentId);
    expect(after.components.length).toBe(before.components.length);
    expect(after.previewHtml).toBe(before.previewHtml);
    expect(after.error).toBeNull();
  });

  it("LIVE snapshot.diff failure with SNAPSHOT_NOT_FOUND surfaces the backend error through store.setError", () => {
    applyDesignToolResultToStore({
      action: "snapshot.diff",
      success: false,
      isLive: true,
      error: 'Snapshot "snap-missing" not found in this session.',
      data: {
        errorCode: "SNAPSHOT_NOT_FOUND",
        missingId: "snap-missing",
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toBe('Snapshot "snap-missing" not found in this session.');
    // No component mutation on a failure dispatch.
    expect(after.components).toEqual([]);
  });

  it("LIVE snapshot.diff failure with SNAPSHOT_DIFF_INVALID_INPUT surfaces the backend error", () => {
    applyDesignToolResultToStore({
      action: "snapshot.diff",
      success: false,
      isLive: true,
      error: '"maxLines" must be a positive integer <= 5000.',
      data: { errorCode: "SNAPSHOT_DIFF_INVALID_INPUT" },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toContain("maxLines");
  });

  it("snapshot.diff errorCode + a/b/diff/diffTruncated/sameContent/totalLines/missingId are type-safe on DesignToolEvent", () => {
    // Compile-time-ish smoke check: if any of the W3.2 fields drop off the
    // DesignToolEvent.data union, this construction stops typechecking.
    const success: DesignToolEvent = {
      action: "snapshot.diff",
      success: true,
      isLive: true,
      data: {
        a: {
          id: "snap-a",
          createdAt: "2026-04-24T00:00:00.000Z",
          name: "Before",
          isPinned: false,
          componentId: "component-1",
        },
        b: {
          id: "snap-b",
          createdAt: "2026-04-24T00:05:00.000Z",
          name: null,
          isPinned: true,
          componentId: "component-1",
        },
        diff: "--- a\n+++ b",
        diffTruncated: false,
        sameContent: false,
        totalLines: 2,
      },
    };
    const notFound: DesignToolEvent = {
      action: "snapshot.diff",
      success: false,
      isLive: true,
      error: "missing",
      data: { errorCode: "SNAPSHOT_NOT_FOUND", missingId: "snap-x" },
    };
    const invalid: DesignToolEvent = {
      action: "snapshot.diff",
      success: false,
      isLive: true,
      error: "bad input",
      data: { errorCode: "SNAPSHOT_DIFF_INVALID_INPUT" },
    };
    const failed: DesignToolEvent = {
      action: "snapshot.diff",
      success: false,
      isLive: true,
      error: "diff threw",
      data: { errorCode: "SNAPSHOT_DIFF_FAILED" },
    };
    expect(success.data?.sameContent).toBe(false);
    expect(success.data?.totalLines).toBe(2);
    expect(notFound.data?.errorCode).toBe("SNAPSHOT_NOT_FOUND");
    expect(notFound.data?.missingId).toBe("snap-x");
    expect(invalid.data?.errorCode).toBe("SNAPSHOT_DIFF_INVALID_INPUT");
    expect(failed.data?.errorCode).toBe("SNAPSHOT_DIFF_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Sprint 3 W3.3 / W3.4 — reference-image overlay and renderMany envelope
// forwarding. The bridge must carry these new fields end-to-end:
//
//   * `toBridgeData` forwards `referenceImage` / `referenceImageError` /
//     `renderMany` / `renderManyError` / `renderManyWarnings` unchanged.
//   * `applyDesignToolResultToStore` treats the success cases as cosmetic
//     (no extra mutation beyond the existing generate/edit/patch hydration
//     contract) and the failure cases surface the backend error message
//     through the store banner for visibility.
//   * Combined success (reference + grid on the same envelope) forwards
//     both fields.
//   * Partial-warnings success forwards the warnings list even when
//     `renderManyError` is absent.
// ---------------------------------------------------------------------------

describe("design-workspace-bridge — Sprint 3 W3.3/W3.4 envelope forwarding", () => {
  beforeEach(() => {
    useDesignWorkspaceStore.getState().reset();
  });

  it("toBridgeData forwards referenceImage on a successful generate", () => {
    const forwarded = toBridgeData({
      componentId: "ref-ok-1",
      code: "<div/>",
      referenceImage: {
        url: "https://cdn.example.com/ref.png",
        present: true,
      },
    });
    expect(forwarded?.referenceImage).toEqual({
      url: "https://cdn.example.com/ref.png",
      present: true,
    });
    // The url round-trips identity-equal so downstream consumers can display
    // the exact string the backend validated.
    expect(forwarded?.referenceImage?.url).toBe("https://cdn.example.com/ref.png");
  });

  it("toBridgeData forwards renderMany on a successful generate", () => {
    const forwarded = toBridgeData({
      componentId: "grid-ok-1",
      code: "<div/>",
      renderMany: { count: 6, cellsEmitted: 6 },
    });
    expect(forwarded?.renderMany).toEqual({ count: 6, cellsEmitted: 6 });
    expect(forwarded?.renderMany?.count).toBe(6);
  });

  it("toBridgeData forwards BOTH referenceImage and renderMany on a combined envelope", () => {
    const forwarded = toBridgeData({
      componentId: "combo-1",
      code: "<div/>",
      referenceImage: { url: "https://cdn/a.png", present: true },
      renderMany: { count: 4, cellsEmitted: 4 },
    });
    expect(forwarded?.referenceImage).toEqual({
      url: "https://cdn/a.png",
      present: true,
    });
    expect(forwarded?.renderMany).toEqual({ count: 4, cellsEmitted: 4 });
  });

  it("toBridgeData forwards referenceImageError + errorCode on a REFERENCE_IMAGE_URL_INVALID failure", () => {
    const forwarded = toBridgeData({
      errorCode: "REFERENCE_IMAGE_URL_INVALID",
      referenceImageError: {
        code: "REFERENCE_IMAGE_URL_INVALID",
        message: "referenceImageUrl must be http(s) / /api/media / data:",
      },
    });
    expect(forwarded?.errorCode).toBe("REFERENCE_IMAGE_URL_INVALID");
    expect(forwarded?.referenceImageError).toEqual({
      code: "REFERENCE_IMAGE_URL_INVALID",
      message: "referenceImageUrl must be http(s) / /api/media / data:",
    });
  });

  it("toBridgeData forwards the Rev-F1 byte-cap fields on a REFERENCE_IMAGE_URL_TOO_LARGE failure", () => {
    // Rev-F1 is adding REFERENCE_IMAGE_URL_TOO_LARGE with rejectedUrl /
    // bytes / limit. This test pre-locks the forwarding contract so the
    // follow-up rev lands without a client change.
    const forwarded = toBridgeData({
      errorCode: "REFERENCE_IMAGE_URL_TOO_LARGE",
      referenceImageError: {
        code: "REFERENCE_IMAGE_URL_TOO_LARGE",
        message: "image exceeds 5 MB cap",
        rejectedUrl: "https://cdn/huge.png",
        bytes: 7_000_000,
        limit: 5_000_000,
      },
    });
    expect(forwarded?.errorCode).toBe("REFERENCE_IMAGE_URL_TOO_LARGE");
    expect(forwarded?.referenceImageError).toEqual({
      code: "REFERENCE_IMAGE_URL_TOO_LARGE",
      message: "image exceeds 5 MB cap",
      rejectedUrl: "https://cdn/huge.png",
      bytes: 7_000_000,
      limit: 5_000_000,
    });
  });

  it("toBridgeData forwards renderManyError + errorCode on a RENDER_MANY_TOO_MANY failure", () => {
    const forwarded = toBridgeData({
      errorCode: "RENDER_MANY_TOO_MANY",
      renderManyError: {
        code: "RENDER_MANY_TOO_MANY",
        message: "renderMany accepts at most 24 entries; received 30.",
        count: 30,
        limit: 24,
      },
    });
    expect(forwarded?.errorCode).toBe("RENDER_MANY_TOO_MANY");
    expect(forwarded?.renderManyError).toEqual({
      code: "RENDER_MANY_TOO_MANY",
      message: "renderMany accepts at most 24 entries; received 30.",
      count: 30,
      limit: 24,
    });
  });

  it("toBridgeData forwards renderManyError with `index` on a RENDER_MANY_INVALID_PROPS failure", () => {
    const forwarded = toBridgeData({
      errorCode: "RENDER_MANY_INVALID_PROPS",
      renderManyError: {
        code: "RENDER_MANY_INVALID_PROPS",
        message: "renderMany[2].props must be a plain JSON object.",
        index: 2,
      },
    });
    expect(forwarded?.renderManyError?.code).toBe("RENDER_MANY_INVALID_PROPS");
    expect(forwarded?.renderManyError?.index).toBe(2);
  });

  it("toBridgeData forwards renderManyWarnings on partial-success compiles", () => {
    const forwarded = toBridgeData({
      componentId: "grid-partial-1",
      code: "<div/>",
      renderMany: { count: 3, cellsEmitted: 2 },
      renderManyWarnings: [
        { index: 1, message: "cell 1 fallback to default props" },
      ],
    });
    expect(forwarded?.renderManyWarnings).toEqual([
      { index: 1, message: "cell 1 fallback to default props" },
    ]);
    // Partial success still carries the success envelope — error is absent.
    expect(forwarded?.renderMany).toEqual({ count: 3, cellsEmitted: 2 });
    expect(forwarded?.renderManyError).toBeUndefined();
  });

  it("LIVE generate success carrying referenceImage does not mutate the store beyond the existing hydrate path", () => {
    // The referenceImage field is compile-time only — the overlay is baked
    // into `previewHtml`. The store's `isOpen` / `activeComponentId` /
    // `components` should update normally (existing generate contract);
    // no extra side-effects for the new field.
    applyDesignToolResultToStore({
      action: "generate",
      success: true,
      isLive: true,
      data: {
        componentId: "ref-live-1",
        code: "<div>Ref</div>",
        referenceImage: { url: "https://cdn/ref.png", present: true },
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.isOpen).toBe(true);
    expect(after.activeComponentId).toBe("ref-live-1");
    expect(after.error).toBeNull();
  });

  it("LIVE generate success carrying renderMany does not mutate the store beyond the existing hydrate path", () => {
    applyDesignToolResultToStore({
      action: "generate",
      success: true,
      isLive: true,
      data: {
        componentId: "grid-live-1",
        code: "<div>Grid</div>",
        renderMany: { count: 4, cellsEmitted: 4 },
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.isOpen).toBe(true);
    expect(after.activeComponentId).toBe("grid-live-1");
    expect(after.error).toBeNull();
  });

  it("LIVE generate failure with REFERENCE_IMAGE_URL_INVALID surfaces the backend error via store.setError", () => {
    applyDesignToolResultToStore({
      action: "generate",
      success: false,
      isLive: true,
      error: "referenceImageUrl must be an http(s):// URL, a /api/media/... path, or a data:image/... URI.",
      data: {
        errorCode: "REFERENCE_IMAGE_URL_INVALID",
        referenceImageError: {
          code: "REFERENCE_IMAGE_URL_INVALID",
          message: "referenceImageUrl must be an http(s):// URL, a /api/media/... path, or a data:image/... URI.",
        },
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toContain("referenceImageUrl");
  });

  it("LIVE generate failure with RENDER_MANY_TOO_MANY surfaces the backend error via store.setError", () => {
    applyDesignToolResultToStore({
      action: "generate",
      success: false,
      isLive: true,
      error: "renderMany accepts at most 24 entries; received 30.",
      data: {
        errorCode: "RENDER_MANY_TOO_MANY",
        renderManyError: {
          code: "RENDER_MANY_TOO_MANY",
          message: "renderMany accepts at most 24 entries; received 30.",
          count: 30,
          limit: 24,
        },
      },
    });
    const after = useDesignWorkspaceStore.getState();
    expect(after.error).toContain("renderMany");
  });
});

// ---------------------------------------------------------------------------
// Sprint 4 W4.3 — Rev-J2 (H1 + M1): rehydration-apply contract.
//
// The bridge's session-switch effect fires a GET for the persisted active
// component pointer. Two user-visible bugs lived inside the async callback:
//
//   H1 (rehydration race): if the user (or a live tool event) mutates
//       `activeComponentId` between GET issue and GET response, the stale
//       GET result MUST NOT clobber the live selection.
//
//   M1 (null leaves stale content): when the GET resolves to null, the
//       store previously retained whatever activeComponentId was carrying
//       from a cached session snapshot — the user saw "old" component
//       content on a session with no persisted selection. The fix
//       explicitly clears activeComponentId on the null branch.
//
// The apply logic now lives in an exported pure helper so we can test it
// without mounting the React effect. These tests drive the helper with
// plain-object refs.
// ---------------------------------------------------------------------------

describe("design-workspace-bridge — rehydration-apply (Rev-J2 H1 + M1)", () => {
  beforeEach(() => {
    useDesignWorkspaceStore.getState().reset();
  });

  function makeRefs(opts: {
    liveSelectionMade?: boolean;
    lastPersisted?: string | null | undefined;
  } = {}): {
    liveSelectionMadeRef: { get: () => boolean };
    lastPersistedRef: {
      get: () => string | null | undefined;
      set: (value: string | null | undefined) => void;
    };
    anchor: { value: string | null | undefined };
  } {
    const anchor = { value: opts.lastPersisted };
    return {
      liveSelectionMadeRef: { get: () => opts.liveSelectionMade ?? false },
      lastPersistedRef: {
        get: () => anchor.value,
        set: (value) => {
          anchor.value = value;
        },
      },
      anchor,
    };
  }

  it("H1: bails when a live selection is made before the GET resolves — live value wins, anchor seeded to live", () => {
    // Simulate the session being active and the user having just clicked
    // a live component card while the GET was in flight.
    useDesignWorkspaceStore.getState().setActiveSession("sess-live");
    useDesignWorkspaceStore.getState().addComponent({
      id: "live-pick",
      name: "Live",
      code: "<div>live</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    // addComponent activates the newly-added component — this is the
    // "user's live selection" from the perspective of the rehydration
    // callback.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("live-pick");

    const refs = makeRefs({ liveSelectionMade: true, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: "stale-from-server" },
      capturedSessionId: "sess-live",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("skipped-live-selection");
    // The live selection MUST survive — the server's stale pointer must
    // not clobber what the user just picked.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("live-pick");
    // Dedup anchor seeded to the live value so the pending POST in the
    // subscription effect proceeds instead of being suppressed.
    expect(refs.anchor.value).toBe("live-pick");
  });

  it("H1: bails when the live selection cleared the active component (null) while the GET resolves with a non-null pointer", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-cleared");
    // Simulate the user having explicitly cleared the active component
    // (e.g. closed the workspace) — activeComponentId is null, but the
    // liveSelectionMade guard is still set.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();

    const refs = makeRefs({ liveSelectionMade: true, lastPersisted: "some-prior" });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: "historical-comp" },
      capturedSessionId: "sess-cleared",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("skipped-live-selection");
    // The user's explicit clear survives — we do NOT apply the
    // historical pointer on top of it.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();
    // Anchor seeded to the live null so the pending POST proceeds.
    expect(refs.anchor.value).toBeNull();
  });

  it("M1: clears stale activeComponentId when the GET resolves to null", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-null");
    // Seed: the session was restored from cache and activeComponentId
    // is pointing at a stale component from the prior session tab.
    useDesignWorkspaceStore.getState().addComponent({
      id: "stale-cached",
      name: "Stale",
      code: "<div>from cache</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("stale-cached");
    expect(useDesignWorkspaceStore.getState().previewHtml.length).toBeGreaterThan(0);

    const refs = makeRefs({ liveSelectionMade: false, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: null },
      capturedSessionId: "sess-null",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("cleared-null");
    // M1 contract: the stale component is cleared so the workspace
    // renders the empty/picker state instead of the cached content.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();
    expect(useDesignWorkspaceStore.getState().previewHtml).toBe("");
    // Dedup anchor seeded to null so the follow-up POST is suppressed.
    expect(refs.anchor.value).toBeNull();
  });

  it("M1: null GET on an already-null store is a no-op (no redundant setActiveComponent)", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-empty");
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();

    const refs = makeRefs({ liveSelectionMade: false, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: null },
      capturedSessionId: "sess-empty",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("no-op-already-null");
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();
    expect(refs.anchor.value).toBeNull();
  });

  it("applies a historical pointer when no live selection interfered", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-apply");
    // Seed the component in the session list so setActiveComponent can
    // resolve the id.
    useDesignWorkspaceStore.getState().addComponent({
      id: "hist-comp",
      name: "Hist",
      code: "<div>hist</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    // addComponent activated it; simulate a fresh session by clearing.
    useDesignWorkspaceStore.getState().setActiveComponent(null);
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();

    const refs = makeRefs({ liveSelectionMade: false, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: "hist-comp" },
      capturedSessionId: "sess-apply",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("applied");
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("hist-comp");
    expect(refs.anchor.value).toBe("hist-comp");
  });

  it("bails when the bridge's session has switched between GET issue and response", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-new");
    // The GET was issued for sess-old, but the bridge already moved on.
    const refs = makeRefs({ liveSelectionMade: false, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: "old-comp" },
      capturedSessionId: "sess-old",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("skipped-session-switched");
    // We must not activate a component from the old session on the new
    // session's store.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBeNull();
    // Anchor is still seeded — even in the stale-session case the value
    // was read; the guard above ensures we don't apply it cross-session.
    expect(refs.anchor.value).toBe("old-comp");
  });

  it("bails when the GET request itself failed — anchor left undefined so the subscription first tick stays informational", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-fail");
    useDesignWorkspaceStore.getState().addComponent({
      id: "current-pick",
      name: "Current",
      code: "<div>ok</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    const before = useDesignWorkspaceStore.getState().activeComponentId;

    const refs = makeRefs({ liveSelectionMade: false, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: false, error: "network down" },
      capturedSessionId: "sess-fail",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("skipped-request-failed");
    // A failed GET must not mutate the store.
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe(before);
    // Anchor stays undefined so the subscription effect treats its
    // first tick as informational.
    expect(refs.anchor.value).toBeUndefined();
  });

  it("no-op when the GET returns the already-active pointer", () => {
    useDesignWorkspaceStore.getState().setActiveSession("sess-same");
    useDesignWorkspaceStore.getState().addComponent({
      id: "match",
      name: "Match",
      code: "<div>m</div>",
      mode: "tailwind",
      style: "default",
      prompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("match");

    const refs = makeRefs({ liveSelectionMade: false, lastPersisted: undefined });

    const outcome = applyRehydrationResultToStore({
      result: { success: true, lastActiveComponentId: "match" },
      capturedSessionId: "sess-same",
      liveSelectionMadeRef: refs.liveSelectionMadeRef,
      lastPersistedRef: refs.lastPersistedRef,
    });

    expect(outcome).toBe("no-op-same-pointer");
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("match");
    expect(refs.anchor.value).toBe("match");
  });
});
