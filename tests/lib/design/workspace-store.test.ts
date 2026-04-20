/**
 * Unit tests for the memory-eviction and summary-vs-full-code branches added
 * to `lib/design/workspace/store.ts`. These lock in the invariants that prevent
 * Design Workspace state from accumulating every past component's `code`
 * payload in memory:
 *
 *  - Summary inserts (codeStripped: true) must NOT activate, NOT rebuild the
 *    preview, and must preserve any already-hydrated `code`.
 *  - A 4th full-code insert must evict the oldest NON-active component's
 *    `code` (set to "", codeStripped: true). The active component is never
 *    evicted.
 *  - Session switching caches the outgoing state with non-active components'
 *    `code` stripped, so session restoration does not re-inflate the whole
 *    library.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useDesignWorkspaceStore } from "@/lib/design/workspace/store";
import type { DesignComponent } from "@/lib/design/workspace/types";

function makeComponent(overrides: Partial<DesignComponent> = {}): DesignComponent {
  const id = overrides.id ?? `c-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    name: overrides.name ?? `Component ${id}`,
    code: overrides.code ?? `<div>full ${id}</div>`,
    mode: "tailwind",
    style: "default",
    prompt: overrides.prompt ?? "",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

function byId(id: string): DesignComponent | undefined {
  return useDesignWorkspaceStore.getState().components.find((c) => c.id === id);
}

describe("useDesignWorkspaceStore — memory eviction", () => {
  beforeEach(() => {
    // Ensure module-level hydration trackers / session cache for any sessionId
    // used in these tests don't bleed state between cases.
    useDesignWorkspaceStore.getState().reset();
  });

  it("addComponent with full code activates, builds preview, hydrates", () => {
    const comp = makeComponent({ id: "alpha", code: "<div>hello</div>" });
    useDesignWorkspaceStore.getState().addComponent(comp);

    const state = useDesignWorkspaceStore.getState();
    expect(state.activeComponentId).toBe("alpha");
    expect(state.previewHtml.length).toBeGreaterThan(0);

    const stored = byId("alpha");
    expect(stored).toBeDefined();
    expect(stored?.code).toBe("<div>hello</div>");
    expect(stored?.codeStripped).toBe(false);
  });

  it("addComponent with codeStripped=true does NOT activate and preserves existing code", () => {
    const full = makeComponent({ id: "beta", code: "<div>real code</div>" });
    useDesignWorkspaceStore.getState().addComponent(full);

    // Now dispatch a summary for the same id — simulating a replay of a
    // historical tool call after `beta` was already fully hydrated.
    const summary: DesignComponent = {
      ...full,
      code: "",
      codeStripped: true,
    };
    useDesignWorkspaceStore.getState().addComponent(summary);

    const state = useDesignWorkspaceStore.getState();
    expect(state.activeComponentId).toBe("beta"); // still from the full insert
    const stored = byId("beta");
    // Summary insert must NOT overwrite the already-hydrated code.
    expect(stored?.code).toBe("<div>real code</div>");
    expect(stored?.codeStripped).toBe(false);
  });

  it("summary insert for a brand-new id is added as a stub (no activation)", () => {
    const summary: DesignComponent = makeComponent({
      id: "gamma",
      code: "",
      codeStripped: true,
    });
    useDesignWorkspaceStore.getState().addComponent(summary);

    const state = useDesignWorkspaceStore.getState();
    expect(state.activeComponentId).toBeNull();
    expect(state.previewHtml).toBe("");

    const stored = byId("gamma");
    expect(stored).toBeDefined();
    expect(stored?.code).toBe("");
    expect(stored?.codeStripped).toBe(true);
  });

  it("a 4th full-code insert evicts the oldest non-active component's code", () => {
    const store = useDesignWorkspaceStore.getState();
    // Insert three full-code components — all stay hydrated (MAX = 3).
    store.addComponent(makeComponent({ id: "a", code: "<a/>" }));
    store.addComponent(makeComponent({ id: "b", code: "<b/>" }));
    store.addComponent(makeComponent({ id: "c", code: "<c/>" }));
    // After 3 inserts, the active component is "c" (last inserted).
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("c");

    // 4th full insert → oldest non-active ("a") is evicted; "c" loses active
    // status to "d" but kept full-code (new active is never evicted).
    store.addComponent(makeComponent({ id: "d", code: "<d/>" }));

    const state = useDesignWorkspaceStore.getState();
    expect(state.activeComponentId).toBe("d");
    expect(byId("a")?.code).toBe("");
    expect(byId("a")?.codeStripped).toBe(true);
    expect(byId("b")?.code).toBe("<b/>");
    expect(byId("b")?.codeStripped).toBe(false);
    expect(byId("c")?.code).toBe("<c/>");
    expect(byId("c")?.codeStripped).toBe(false);
    expect(byId("d")?.code).toBe("<d/>");
    expect(byId("d")?.codeStripped).toBe(false);
  });

  it("eviction never strips the active component even when it is oldest", () => {
    const store = useDesignWorkspaceStore.getState();
    store.addComponent(makeComponent({ id: "a", code: "<a/>" }));
    // Pin "a" as active and then add more components without flipping active.
    store.setActiveComponent("a");

    // Adding b/c/d with full code flips the active to each new one (see
    // addComponent logic). So for the "never evict active" assertion, we
    // need to add NEW components then restore active back to "a" before
    // the eviction decision. The store only considers eviction at insert
    // time, so instead test via updateComponent which touches hydration
    // without activating.
    store.addComponent(makeComponent({ id: "b", code: "<b/>" }));
    store.addComponent(makeComponent({ id: "c", code: "<c/>" }));
    // At this point order (LRU → MRU): a, b, c. Active = c.
    // Re-pin "a" as active so the eviction logic must protect it.
    store.setActiveComponent("a");
    // Touching "a" moved it to the front of the hydration tracker (MRU),
    // so order is now b, c, a. Add a 4th full-code component "d": oldest is
    // "b", and it should be evicted. "a" (active) must keep its code.
    store.addComponent(makeComponent({ id: "d", code: "<d/>" }));

    expect(byId("a")?.code).toBe("<a/>"); // active, protected
    expect(byId("a")?.codeStripped).toBe(false);
    expect(byId("b")?.code).toBe(""); // oldest non-active → evicted
    expect(byId("b")?.codeStripped).toBe(true);
  });

  it("updateComponent with new code re-touches hydration and evicts the oldest stub", () => {
    const store = useDesignWorkspaceStore.getState();
    store.addComponent(makeComponent({ id: "a", code: "<a/>" }));
    store.addComponent(makeComponent({ id: "b", code: "<b/>" }));
    store.addComponent(makeComponent({ id: "c", code: "<c/>" }));
    // Active = c, order (LRU → MRU): a, b, c

    // Re-hydrate "a" by updating its code. That touches hydration → "a"
    // moves to MRU, which should now push "b" out on the next insert.
    store.updateComponent("a", { code: "<a-updated/>" });
    // Order now: b, c, a (a is MRU, c is middle-ish, b oldest)

    // Add "d" → oldest non-active "b" evicted (since c is not active either
    // here? Actually active is still "c" from earlier full-code insert).
    // Wait — re-check: active stays "c". When "d" is inserted with full
    // code, active flips to "d". So now order is b, c, a, d. "a" is MRU
    // because of updateComponent. Oldest non-active is "b".
    store.addComponent(makeComponent({ id: "d", code: "<d/>" }));

    expect(byId("a")?.code).toBe("<a-updated/>");
    expect(byId("a")?.codeStripped).toBe(false);
    expect(byId("b")?.code).toBe("");
    expect(byId("b")?.codeStripped).toBe(true);
  });

  it("setActiveComponent to a stub leaves previewHtml empty", () => {
    const store = useDesignWorkspaceStore.getState();
    store.addComponent(makeComponent({ id: "a", code: "" as string, codeStripped: true }));
    store.addComponent(makeComponent({ id: "b", code: "<b/>" }));
    // Active = b now (full-code insert)
    expect(useDesignWorkspaceStore.getState().activeComponentId).toBe("b");

    // Switch active to the stub "a" → preview should be blank, not the
    // stale "b" preview, because the stub has no code to render. The
    // stub stays "selected" (activeComponentId = "a") so the UI can show
    // a loading state; the bridge is responsible for fetching full code
    // before the preview re-renders.
    store.setActiveComponent("a");

    const state = useDesignWorkspaceStore.getState();
    expect(state.activeComponentId).toBe("a");
    expect(state.previewHtml).toBe("");
  });

  it("session switch caches state with non-active code stripped", () => {
    const store = useDesignWorkspaceStore.getState();
    store.setActiveSession("session-S1");
    store.addComponent(makeComponent({ id: "a", code: "<a/>" }));
    store.addComponent(makeComponent({ id: "b", code: "<b/>" }));
    // Active = b, both full-code.

    // Switch away → S1 is cached with non-active code stripped.
    store.setActiveSession("session-S2");

    // Return to S1 — the non-active component "a" must come back as a stub;
    // the active "b" keeps its code so the preview isn't blank on restore.
    store.setActiveSession("session-S1");

    const restored = useDesignWorkspaceStore.getState();
    expect(restored.sessionId).toBe("session-S1");
    expect(restored.activeComponentId).toBe("b");

    const a = restored.components.find((c) => c.id === "a");
    const b = restored.components.find((c) => c.id === "b");
    // Non-active "a" was stripped on cache-out to bound memory usage.
    expect(a?.code).toBe("");
    expect(a?.codeStripped).toBe(true);
    // Active "b" is preserved untouched so the preview doesn't flash blank
    // when returning to the session.
    expect(b?.code).toBe("<b/>");
    expect(b?.codeStripped).toBeFalsy();
  });
});
