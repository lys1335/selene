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
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDesignToolResultToStore,
  type DesignToolEvent,
} from "@/components/design/design-workspace-bridge";
import { useDesignWorkspaceStore } from "@/lib/design/workspace/store";

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
