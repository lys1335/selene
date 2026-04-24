/**
 * Sprint 4 W4.1 — CDP state harness unit tests.
 *
 * These tests drive `captureScreenshotUnderPseudoState` directly so we can
 * lock in the CDP sequencing contract without spinning up Puppeteer or a
 * real Chromium process. What they prove:
 *
 *   1. A well-formed entry (hover/focus-visible/active/disabled + a
 *      resolvable selector) runs the CDP call chain in order:
 *      `DOM.enable` → `DOM.getDocument` → `DOM.querySelector` →
 *      `CSS.forcePseudoState({forcedPseudoClasses: [pseudo]})`, then
 *      re-runs `CSS.forcePseudoState({forcedPseudoClasses: []})` to
 *      clear the forced state after the screenshot is persisted.
 *
 *   2. N entries produce N distinct captures, each carrying the correct
 *      `label` / `pseudo` / `selector` — proving the harness is not
 *      cross-contaminating entries.
 *
 *   3. An unsupported pseudo-class surfaces as a structured
 *      `STATE_INVALID_PSEUDO` error WITHOUT ever touching the CDP session
 *      or screenshot pipeline — so a typo on one entry cannot break the
 *      base screenshot or adjacent state captures.
 *
 *   4. A selector that doesn't resolve (DOM.querySelector returns nodeId 0)
 *      surfaces as `STATE_SELECTOR_NOT_FOUND` with the offending selector
 *      echoed back, and the harness does NOT attempt to write a screenshot.
 *
 *   5. The tool-boundary normalizer
 *      (`normalizeStateRequests`) drops malformed entries before the
 *      screenshot service sees them — verified separately so the tool
 *      schema surface has the same guarantees as the CDP wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// saveFile is invoked from inside captureScreenshotUnderPseudoState to
// persist the state PNG. Stub it to a deterministic URL so the test doesn't
// touch the local media store.
vi.mock("@/lib/storage/local-storage", () => ({
  saveFile: vi.fn(async (_buf: Buffer, sessionId: string, filename: string) => ({
    localPath: `/mock/${sessionId}/${filename}`,
    url: `/api/media/${sessionId}/${filename}`,
    filePath: `/mock-abs/${sessionId}/${filename}`,
  })),
}));

// Pull the module AFTER the mock so the internal `saveFile` reference
// points at the stubbed version.
const { captureScreenshotUnderPseudoState, normalizeStateRequestsForTest } =
  await (async () => {
    const screenshotMod = await import("../screenshot");
    // normalizeStateRequests lives in the tool module, not the screenshot
    // module — import it directly here.
    const toolMod = await import("../../../ai/tools/design-workspace-tool");
    return {
      captureScreenshotUnderPseudoState: screenshotMod.captureScreenshotUnderPseudoState,
      normalizeStateRequestsForTest: toolMod.normalizeStateRequests,
    };
  })();

type CdpCall = { method: string; params?: Record<string, unknown> };

interface FakeCdp {
  calls: CdpCall[];
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  detach: () => Promise<void>;
}

interface FakePage {
  target: () => { createCDPSession: () => Promise<FakeCdp> };
  screenshot: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
}

/**
 * Build a CDP mock that returns a deterministic root node + queryable
 * selector map. Selectors NOT in `resolvableSelectors` return nodeId 0
 * (DOM.querySelector's "no match" sentinel).
 */
function makeFakeCdp(args: {
  resolvableSelectors: Record<string, number>; // selector -> nodeId
}): FakeCdp {
  const calls: CdpCall[] = [];
  let nextNodeCounter = 100;
  return {
    calls,
    async send(method, params) {
      calls.push({ method, params });
      if (method === "DOM.enable") return {};
      if (method === "DOM.getDocument") {
        return { root: { nodeId: 1 } };
      }
      if (method === "DOM.querySelector") {
        const selector = String(params?.selector ?? "");
        const mapped = args.resolvableSelectors[selector];
        if (mapped !== undefined) return { nodeId: mapped };
        return { nodeId: 0 };
      }
      if (method === "CSS.forcePseudoState") {
        return {};
      }
      // Default — bump counter so any new CDP calls don't quietly collide.
      nextNodeCounter += 1;
      return {};
    },
    async detach() {
      // noop
    },
  };
}

function makeFakePage(cdp: FakeCdp): FakePage {
  return {
    target: () => ({ createCDPSession: async () => cdp }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    evaluate: vi.fn().mockResolvedValue(2), // devicePixelRatio
  };
}

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureScreenshotUnderPseudoState — Sprint 4 W4.1 CDP sequencing", () => {
  it("forces the pseudo-class via CDP, persists a PNG, and clears the forced state afterwards", async () => {
    const cdp = makeFakeCdp({ resolvableSelectors: { ".btn": 42 } });
    const page = makeFakePage(cdp);

    const result = await captureScreenshotUnderPseudoState({
      page,
      entry: { selector: ".btn", pseudo: "hover" },
      viewport: VIEWPORT,
      fileNameBase: "TestComponent",
      sessionId: "sess-1",
      fullPage: false,
      captureBeyondViewport: false,
    });

    // The successful-capture branch: no `error` field, populated screenshot.
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unreachable");
    expect(result.label).toBe("hover:.btn");
    expect(result.pseudo).toBe("hover");
    expect(result.selector).toBe(".btn");
    expect(result.screenshot.url).toMatch(/^\/api\/media\/sess-1\//);
    expect(result.screenshot.width).toBe(1440);
    expect(result.screenshot.height).toBe(900);
    expect(result.screenshot.dpr).toBe(2);

    // CDP sequencing: DOM.enable → CSS.enable → getDocument → querySelector
    // → force → clear. CSS.enable is required because `CSS.forcePseudoState`
    // is a CSS-domain command — without it, CDP rejects the force call with
    // "'CSS.forcePseudoState' wasn't found" on the pinned runtime.
    const methodSeq = cdp.calls.map((c) => c.method);
    expect(methodSeq[0]).toBe("DOM.enable");
    expect(methodSeq[1]).toBe("CSS.enable");
    expect(methodSeq[2]).toBe("DOM.getDocument");
    expect(methodSeq[3]).toBe("DOM.querySelector");
    // The FORCE call: forcedPseudoClasses contains the requested pseudo.
    const forceCall = cdp.calls.find(
      (c) =>
        c.method === "CSS.forcePseudoState" &&
        Array.isArray(c.params?.forcedPseudoClasses) &&
        (c.params?.forcedPseudoClasses as string[]).includes("hover"),
    );
    expect(forceCall).toBeDefined();
    expect(forceCall?.params?.nodeId).toBe(42);
    // The CLEAR call: forcedPseudoClasses is an empty array AFTER the force.
    const clearCall = cdp.calls.find(
      (c) =>
        c.method === "CSS.forcePseudoState" &&
        Array.isArray(c.params?.forcedPseudoClasses) &&
        (c.params?.forcedPseudoClasses as string[]).length === 0,
    );
    expect(clearCall).toBeDefined();

    // Screenshot was taken once with the caller-provided fullPage flags.
    expect(page.screenshot).toHaveBeenCalledTimes(1);
    expect(page.screenshot).toHaveBeenCalledWith({
      type: "png",
      fullPage: false,
      captureBeyondViewport: false,
    });
  });

  it("respects a caller-supplied label", async () => {
    const cdp = makeFakeCdp({ resolvableSelectors: { "button.primary": 7 } });
    const page = makeFakePage(cdp);

    const result = await captureScreenshotUnderPseudoState({
      page,
      entry: { selector: "button.primary", pseudo: "focus-visible", label: "Primary:focus" },
      viewport: VIEWPORT,
      fileNameBase: "Comp",
      sessionId: "sess-2",
      fullPage: false,
      captureBeyondViewport: false,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unreachable");
    expect(result.label).toBe("Primary:focus");
    expect(result.pseudo).toBe("focus-visible");
  });

  it("uses the `focus-visible` CDP pseudo verbatim (not `focus` / `focusvisible`)", async () => {
    const cdp = makeFakeCdp({ resolvableSelectors: { "input": 17 } });
    const page = makeFakePage(cdp);

    await captureScreenshotUnderPseudoState({
      page,
      entry: { selector: "input", pseudo: "focus-visible" },
      viewport: VIEWPORT,
      fileNameBase: "F",
      sessionId: "sess-3",
      fullPage: false,
      captureBeyondViewport: false,
    });

    const forceCall = cdp.calls.find(
      (c) =>
        c.method === "CSS.forcePseudoState" &&
        Array.isArray(c.params?.forcedPseudoClasses) &&
        (c.params?.forcedPseudoClasses as string[]).length > 0,
    );
    expect(forceCall?.params?.forcedPseudoClasses).toEqual(["focus-visible"]);
  });

  it("returns STATE_INVALID_PSEUDO for an unsupported pseudo and skips the CDP + screenshot calls entirely", async () => {
    const cdp = makeFakeCdp({ resolvableSelectors: { ".x": 1 } });
    const page = makeFakePage(cdp);

    const result = await captureScreenshotUnderPseudoState({
      page,
      entry: {
        selector: ".x",
        // Deliberately force a disallowed pseudo through the type boundary
        // to simulate a bad runtime payload. The wrapper must reject without
        // touching CDP.
        pseudo: "target" as unknown as "hover",
      },
      viewport: VIEWPORT,
      fileNameBase: "F",
      sessionId: "sess-4",
      fullPage: false,
      captureBeyondViewport: false,
    });

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("unreachable");
    expect(result.error.code).toBe("STATE_INVALID_PSEUDO");
    expect(result.pseudo).toBe("target");
    expect(result.selector).toBe(".x");
    // No CDP traffic, no screenshot.
    expect(cdp.calls).toHaveLength(0);
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("returns STATE_SELECTOR_NOT_FOUND when DOM.querySelector yields nodeId 0 and does NOT persist a screenshot", async () => {
    // Only `.known` resolves; the entry below uses `.missing`.
    const cdp = makeFakeCdp({ resolvableSelectors: { ".known": 99 } });
    const page = makeFakePage(cdp);

    const result = await captureScreenshotUnderPseudoState({
      page,
      entry: { selector: ".missing", pseudo: "hover" },
      viewport: VIEWPORT,
      fileNameBase: "F",
      sessionId: "sess-5",
      fullPage: false,
      captureBeyondViewport: false,
    });

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("unreachable");
    expect(result.error.code).toBe("STATE_SELECTOR_NOT_FOUND");
    expect(result.selector).toBe(".missing");

    // CDP got as far as querySelector; after the nodeId:0 result, no
    // CSS.forcePseudoState force call should have run.

    const force = cdp.calls.find(
      (c) =>
        c.method === "CSS.forcePseudoState" &&
        Array.isArray(c.params?.forcedPseudoClasses) &&
        (c.params?.forcedPseudoClasses as string[]).length > 0,
    );
    expect(force).toBeUndefined();
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("returns STATE_SELECTOR_INVALID for an empty selector string and never touches CDP", async () => {
    // Defensive-in-depth: `normalizeStateRequests` in the tool boundary drops
    // empty selectors before they reach the screenshot service. But the
    // helper MUST still emit a structured error envelope if a direct caller
    // bypasses normalization. This test locks that contract in.
    const cdp: FakeCdp = {
      calls: [],
      async send(method, params) {
        cdp.calls.push({ method, params });
        return {};
      },
      async detach() {},
    };
    const page = makeFakePage(cdp);

    const result = await captureScreenshotUnderPseudoState({
      page,
      entry: { selector: "", pseudo: "hover" },
      viewport: VIEWPORT,
      fileNameBase: "F",
      sessionId: "sess-5b",
      fullPage: false,
      captureBeyondViewport: false,
    });

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("unreachable");
    expect(result.error.code).toBe("STATE_SELECTOR_INVALID");
    // Zero CDP calls and zero screenshot writes: we reject before touching Chrome.
    expect(cdp.calls.length).toBe(0);
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("returns STATE_CAPTURE_FAILED when CDP throws mid-sequence and echoes the error message", async () => {
    const cdp: FakeCdp = {
      calls: [],
      async send(method, params) {
        cdp.calls.push({ method, params });
        if (method === "DOM.getDocument") {
          throw new Error("simulated CDP boom");
        }
        if (method === "DOM.enable") return {};
        return {};
      },
      async detach() {},
    };
    const page = makeFakePage(cdp);

    const result = await captureScreenshotUnderPseudoState({
      page,
      entry: { selector: ".btn", pseudo: "active" },
      viewport: VIEWPORT,
      fileNameBase: "F",
      sessionId: "sess-6",
      fullPage: false,
      captureBeyondViewport: false,
    });

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("unreachable");
    expect(result.error.code).toBe("STATE_CAPTURE_FAILED");
    expect(result.error.message).toContain("simulated CDP boom");
  });

  it("N entries produce N distinct captures with the correct pseudo applied to each", async () => {
    // One CDP per entry (fresh page per state) — we simulate that by
    // building a fresh fake for each call, which is exactly the shape the
    // production loop creates via `acquirePage()`.
    const entries = [
      { selector: ".btn", pseudo: "hover" as const, label: "Hover" },
      { selector: ".btn", pseudo: "focus-visible" as const },
      { selector: ".btn", pseudo: "active" as const },
    ];

    const results = [];
    for (const entry of entries) {
      const cdp = makeFakeCdp({ resolvableSelectors: { ".btn": 55 } });
      const page = makeFakePage(cdp);
      const r = await captureScreenshotUnderPseudoState({
        page,
        entry,
        viewport: VIEWPORT,
        fileNameBase: "Comp",
        sessionId: "sess-n",
        fullPage: false,
        captureBeyondViewport: false,
      });
      results.push({ cdp, page, r });
    }

    expect(results).toHaveLength(3);
    for (const { r } of results) {
      expect("error" in r).toBe(false);
    }
    // Pseudo applied differs per entry.
    const pseudoSeq = results.map(({ cdp }) =>
      cdp.calls
        .filter(
          (c) =>
            c.method === "CSS.forcePseudoState" &&
            Array.isArray(c.params?.forcedPseudoClasses) &&
            (c.params?.forcedPseudoClasses as string[]).length > 0,
        )
        .map((c) => (c.params?.forcedPseudoClasses as string[])[0]),
    );
    expect(pseudoSeq).toEqual([["hover"], ["focus-visible"], ["active"]]);

    // Labels default when omitted, caller-supplied when present.
    expect(results[0].r.label).toBe("Hover");
    expect(results[1].r.label).toBe("focus-visible:.btn");
    expect(results[2].r.label).toBe("active:.btn");
  });
});

describe("normalizeStateRequests — Sprint 4 W4.1 tool-boundary normalization", () => {
  it("accepts a well-formed entry and preserves selector/pseudo/label", () => {
    const out = normalizeStateRequestsForTest([
      { selector: ".btn", pseudo: "hover", label: "Primary hover" },
    ]);
    expect(out).toEqual([
      { selector: ".btn", pseudo: "hover", label: "Primary hover" },
    ]);
  });

  it("drops entries with unsupported pseudo without rejecting the whole batch", () => {
    const out = normalizeStateRequestsForTest([
      { selector: ".btn", pseudo: "hover" },
      // @ts-expect-error — deliberately malformed runtime input.
      { selector: ".bad", pseudo: "visited" },
      { selector: ".other", pseudo: "focus-visible" },
    ]);
    expect(out).toEqual([
      { selector: ".btn", pseudo: "hover" },
      { selector: ".other", pseudo: "focus-visible" },
    ]);
  });

  it("drops entries with empty / missing selector", () => {
    const out = normalizeStateRequestsForTest([
      { selector: "", pseudo: "hover" },
      // @ts-expect-error — missing selector.
      { pseudo: "hover" },
      { selector: "   ", pseudo: "hover" },
      { selector: ".real", pseudo: "hover" },
    ]);
    expect(out).toEqual([{ selector: ".real", pseudo: "hover" }]);
  });

  it("caps at 8 entries", () => {
    const bulk = Array.from({ length: 20 }, (_, i) => ({
      selector: `.x-${i}`,
      pseudo: "hover" as const,
    }));
    const out = normalizeStateRequestsForTest(bulk);
    expect(out).toHaveLength(8);
    expect(out?.[0]?.selector).toBe(".x-0");
    expect(out?.[7]?.selector).toBe(".x-7");
  });

  it("returns undefined for empty / non-array / all-invalid input", () => {
    expect(normalizeStateRequestsForTest(undefined)).toBeUndefined();
    expect(normalizeStateRequestsForTest([])).toBeUndefined();
    // All entries malformed → normalized result is empty → returns undefined
    // so the screenshot service falls through to the base-only path.
    expect(
      normalizeStateRequestsForTest([
        // @ts-expect-error — deliberate runtime garbage.
        { selector: null, pseudo: "hover" },
        // @ts-expect-error — deliberate runtime garbage.
        { selector: ".x", pseudo: "nope" },
      ]),
    ).toBeUndefined();
  });
});
