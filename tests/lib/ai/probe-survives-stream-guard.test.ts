/**
 * Regression test proving computed-style probes survive the tool-output
 * pipeline when a screenshot is attached to the result.
 *
 * Context — Sprint 1 Group B claim:
 *   Agents reported that probe data was "truncated by the tool-output
 *   envelope" for backdrop-filter (T1.3), color-scheme (T1.5), and
 *   dashboard layout probes (T1.6).
 *
 * What the pipeline actually does:
 *   1. `executeDesignWorkspace` / `slimResult` returns a
 *      `DesignWorkspaceResult` where probes live at `data.probes` (a
 *      nested object — NOT a top-level string field).
 *   2. `guardToolResultForStreaming` (app/api/chat/tools-builder.ts:815)
 *      estimates token size. On oversize it calls `replacePrimaryText`,
 *      which only rewrites top-level string fields (stdout/stderr/
 *      content/text/result/results/output/summary/markdown) and falls
 *      back to attaching `output: stub`. It does NOT recurse into `data`.
 *      → `data.probes` is preserved verbatim.
 *   3. `designWorkspaceToModelOutput` serializes the whole guarded result
 *      as the text content part alongside the image content part.
 *      → probes round-trip into `text = JSON.stringify(result)`.
 *
 * These tests pin the invariant at both tiers (≤10K tokens passthrough
 * and >10K tokens stream-guarded), so the guard / envelope can never
 * silently regress probe delivery again. If Group B ever regresses, the
 * true root cause will be upstream (the curated `PROBE_CSS_PROPERTIES`
 * list in `lib/design/workspace/screenshot.ts` or the CDP `collectProbes`
 * eval), not the envelope.
 */

import { describe, it, expect } from "vitest";
import { guardToolResultForStreaming } from "@/lib/ai/tool-result-stream-guard";
import { designWorkspaceToModelOutput } from "@/lib/ai/tools/design-workspace-tool";

function padMessage(base: string, targetChars: number): string {
  const filler = " lorem ipsum dolor sit amet consectetur adipiscing elit sed";
  let s = base;
  while (s.length < targetChars) s += filler;
  return s;
}

describe("probe survival through stream guard + toModelOutput", () => {
  it("probes + screenshot survive stream guard when result is ≤10K tokens (passthrough tier)", () => {
    const result = {
      success: true,
      action: "generate" as const,
      data: {
        message: "Generated component.",
        componentId: "cmp_small",
        generatedAt: Date.now(),
        screenshot: { url: "/api/media/s.png", width: 1280, height: 720, dpr: 2 },
        probes: {
          ".glass-panel": {
            backdropFilter: "blur(20px) saturate(150%)",
            backgroundColor: "rgba(255, 255, 255, 0.1)",
          },
          "button.primary": {
            backgroundColor: "rgb(59, 130, 246)",
            color: "rgb(255, 255, 255)",
          },
        },
        previewHtmlRef: { length: 85_000, getVia: "readSource" as const },
      },
    };

    const guarded = guardToolResultForStreaming("designWorkspace", result, {
      initialActiveTools: new Set(["designWorkspace", "retrieveFullContent"]),
      discoveredTools: new Set(),
    });

    // Small result → passthrough, not blocked.
    expect(guarded.blocked).toBe(false);
    const out = guarded.result as typeof result;
    expect(out.data.probes).toBeDefined();
    expect(out.data.probes![".glass-panel"].backdropFilter).toBe(
      "blur(20px) saturate(150%)"
    );

    // toModelOutput must emit both text + image content parts, with probes in text.
    const model = designWorkspaceToModelOutput(out) as {
      type: "content";
      value: Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "url"; url: string } }
      >;
    };
    expect(model.type).toBe("content");
    const textPart = model.value.find((p) => p.type === "text") as {
      type: "text";
      text: string;
    };
    expect(textPart.text).toContain("glass-panel");
    expect(textPart.text).toContain("blur(20px)");
    expect(textPart.text).toContain("rgba(255, 255, 255, 0.1)");
  });

  it("probes survive stream guard when result EXCEEDS 10K tokens (preview_plus_stub tier)", () => {
    // Pad the result so JSON.stringify exceeds the 10K-token inline
    // passthrough budget but stays under the 25K-token stub-only ceiling.
    const bigMessage = padMessage("Generated component. ", 60_000);

    const result = {
      success: true,
      action: "generate" as const,
      data: {
        message: bigMessage,
        componentId: "cmp_big",
        generatedAt: Date.now(),
        screenshot: { url: "/api/media/big.png", width: 1280, height: 720, dpr: 2 },
        probes: {
          ".glass-panel": {
            backdropFilter: "blur(20px) saturate(150%)",
            backgroundColor: "rgba(255, 255, 255, 0.1)",
          },
          "[data-slot='root']": {
            colorScheme: "light dark",
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          },
        },
        previewHtmlRef: { length: 85_000, getVia: "readSource" as const },
      },
    };

    const guarded = guardToolResultForStreaming("designWorkspace", result, {
      initialActiveTools: new Set(["designWorkspace", "retrieveFullContent"]),
      discoveredTools: new Set(),
    });

    // Large result → stream guard fires.
    expect(guarded.blocked).toBe(true);

    const out = guarded.result as Record<string, unknown>;
    const data = out.data as Record<string, unknown> | undefined;
    const probes = data?.probes as
      | Record<string, Record<string, string>>
      | undefined;

    // The raw probe map must be preserved verbatim — the guard's
    // `replacePrimaryText` only touches top-level string fields.
    expect(probes).toBeDefined();
    expect(probes![".glass-panel"].backdropFilter).toBe(
      "blur(20px) saturate(150%)"
    );
    expect(probes!["[data-slot='root']"].colorScheme).toBe("light dark");
    expect(probes!["[data-slot='root']"].gridTemplateColumns).toBe(
      "repeat(12, minmax(0, 1fr))"
    );

    // And they must round-trip through toModelOutput into the text part the
    // LLM reads alongside the image.
    const model = designWorkspaceToModelOutput(out) as {
      type: "content";
      value: Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "url"; url: string } }
      >;
    };
    const textPart = model.value.find((p) => p.type === "text") as {
      type: "text";
      text: string;
    };
    expect(textPart.text).toContain("glass-panel");
    expect(textPart.text).toContain("blur(20px)");
    expect(textPart.text).toContain("colorScheme");
    expect(textPart.text).toContain("light dark");
    expect(textPart.text).toContain("gridTemplateColumns");
  });

  it("probes survive even when the result triggers the stub_only tier (>25K tokens)", () => {
    // Push the payload well past the PREVIEW_TIER_TOKENS ceiling so the
    // guard emits the outline-only stub (no head preview at all).
    const hugeMessage = padMessage("Generated component. ", 200_000);

    const result = {
      success: true,
      action: "generate" as const,
      data: {
        message: hugeMessage,
        componentId: "cmp_huge",
        generatedAt: Date.now(),
        screenshot: { url: "/api/media/huge.png", width: 1280, height: 720, dpr: 2 },
        probes: {
          ".hero": {
            backdropFilter: "blur(32px)",
            textShadow: "0 2px 8px rgba(0,0,0,0.25)",
          },
        },
        previewHtmlRef: { length: 200_000, getVia: "readSource" as const },
      },
    };

    const guarded = guardToolResultForStreaming("designWorkspace", result, {
      initialActiveTools: new Set(["designWorkspace", "retrieveFullContent"]),
      discoveredTools: new Set(),
    });

    expect(guarded.blocked).toBe(true);

    const out = guarded.result as Record<string, unknown>;
    const data = out.data as Record<string, unknown> | undefined;
    const probes = data?.probes as
      | Record<string, Record<string, string>>
      | undefined;

    // Invariant: even at the strictest tier, probes must NOT be dropped.
    expect(probes).toBeDefined();
    expect(probes![".hero"].backdropFilter).toBe("blur(32px)");
    expect(probes![".hero"].textShadow).toBe("0 2px 8px rgba(0,0,0,0.25)");
  });
});
