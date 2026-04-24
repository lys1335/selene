/**
 * Sprint 1 Group B — locks in the curated `PROBE_CSS_PROPERTIES` list.
 *
 * The design-workspace probe pipeline returns a fixed subset of the
 * `CSSStyleDeclaration` keys per probed selector. When the list is too
 * narrow, agents requesting properties that aren't in it see `_error` or
 * an absent key in the returned map and report "probe data truncated by
 * tool output envelope" — which mis-identifies the curated-list gap as
 * an envelope / stream-guard bug.
 *
 * (The `probe-survives-stream-guard.test.ts` regression proves the
 * envelope preserves `data.probes` verbatim at every stream-guard tier.
 * This test pins the companion invariant: the list must cover the
 * properties referenced in Sprint 1 T1.3 / T1.5 / T1.6 and the typical
 * design-QA surface so agent reports stay in sync with reality.)
 */

import { describe, it, expect } from "vitest";
import { PROBE_CSS_PROPERTIES } from "../screenshot";

describe("PROBE_CSS_PROPERTIES — curated list", () => {
  const set = new Set<string>(PROBE_CSS_PROPERTIES as readonly string[]);

  it("covers the Sprint 1 T1.3 / T1.5 / T1.6 probe surface", () => {
    // T1.3 — backdrop-filter probes on glass panels.
    expect(set.has("backdropFilter")).toBe(true);
    // T1.5 — resolved color-scheme on the theme-aware root.
    expect(set.has("colorScheme")).toBe(true);
    // T1.6 — dashboard layout probes (flex / grid).
    expect(set.has("display")).toBe(true);
    expect(set.has("flexDirection")).toBe(true);
    expect(set.has("justifyContent")).toBe(true);
    expect(set.has("alignItems")).toBe(true);
    expect(set.has("gap")).toBe(true);
    expect(set.has("gridTemplateColumns")).toBe(true);
    expect(set.has("gridTemplateRows")).toBe(true);
  });

  it("still covers the historical visual-fidelity surface (color / typography / box)", () => {
    for (const prop of [
      "color",
      "backgroundColor",
      "boxShadow",
      "border",
      "borderRadius",
      "opacity",
      "transform",
      "filter",
      "width",
      "height",
      "padding",
      "margin",
      "font",
      "letterSpacing",
      "lineHeight",
      "position",
      "zIndex",
    ]) {
      expect(set.has(prop)).toBe(true);
    }
  });

  it("covers interaction + animation properties common to design QA", () => {
    expect(set.has("cursor")).toBe(true);
    expect(set.has("transition")).toBe(true);
    expect(set.has("textShadow")).toBe(true);
    expect(set.has("overflow")).toBe(true);
  });

  it("uses camelCase keys (CSSStyleDeclaration-indexable, not kebab-case)", () => {
    for (const prop of PROBE_CSS_PROPERTIES as readonly string[]) {
      expect(prop).not.toContain("-");
    }
  });

  it("has no duplicate entries", () => {
    const unique = new Set(PROBE_CSS_PROPERTIES as readonly string[]);
    expect(unique.size).toBe((PROBE_CSS_PROPERTIES as readonly string[]).length);
  });

  it("keeps the curated list compact enough for typical probe payloads", () => {
    // Hard ceiling on property count so additions stay deliberate.
    // Anything bigger and this list should graduate to a caller-supplied
    // `probeProperties` array with stricter per-request bounds. At the
    // typical probe shape (4 selectors × ~60-char values) the resulting
    // payload stays well under the 10K-token inline passthrough budget
    // and the 40 KB `SLIM_RESULT_SAFETY_CAP`.
    expect(PROBE_CSS_PROPERTIES.length).toBeGreaterThanOrEqual(20);
    expect(PROBE_CSS_PROPERTIES.length).toBeLessThanOrEqual(40);

    const typicalSelectors = 4;
    const typicalBytesPerValue = 60;
    const typicalPayload =
      PROBE_CSS_PROPERTIES.length * typicalSelectors * typicalBytesPerValue;
    expect(typicalPayload).toBeLessThan(10_000);
  });
});
