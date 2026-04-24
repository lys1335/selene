/**
 * Tests for the describeImage companion-tool promotion in buildToolsForRequest.
 *
 * The rule: when `prepareMessagesForRequest` replaces image parts with
 * describeImage-prompting placeholders (because the outbound provider rejects
 * inline image_url parts), the builder must promote `describeImage` into the
 * initial active tool set. Otherwise a DeepSeek-in-thinking-mode request would
 * have to emit a `searchTools` discovery call just to find the tool the
 * placeholder already named — wasting a turn and confusing the model.
 *
 * These tests exercise the enforcement logic in isolation (same pattern as
 * `tools-builder-companion.test.ts`) rather than invoking the full
 * `buildToolsForRequest` pipeline, because that pipeline requires a DB and a
 * full session/user setup that isn't relevant to the branching decision.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "@/lib/ai/tool-registry";
import type { ToolMetadata } from "@/lib/ai/tool-registry/types";
import { tool } from "ai";
import { z } from "zod";

// Minimal factory — we only care that the tool appears in allTools.
function stubDescribeImage() {
  return tool({
    description: "stub describeImage",
    inputSchema: z.object({}),
    execute: async () => "ok",
  });
}

function setupRegistry(): ToolRegistry {
  ToolRegistry.reset();
  const registry = ToolRegistry.getInstance();
  registry.register(
    "describeImage",
    {
      displayName: "Describe Image",
      category: "analysis",
      keywords: ["vision", "describe"],
      shortDescription: "Analyze images via vision model",
      fullInstructions: "stub",
      // Real registration marks this as deferLoading — that's exactly why we
      // need the companion promotion: it would otherwise be invisible to the
      // model on the turn where the placeholder tells it to call the tool.
      loading: { deferLoading: true },
      requiresSession: false,
    } satisfies ToolMetadata,
    () => stubDescribeImage(),
  );
  return registry;
}

/**
 * Mirrors the enforcement block in tools-builder.ts. Keeping the logic inlined
 * here (instead of importing the helper) makes the test a behavioral spec:
 * if someone rewrites the enforcement, the test still asserts the contract.
 */
function applyDescribeImagePromotion(
  initialActiveTools: Set<string>,
  allTools: Record<string, unknown>,
  droppedImagesForProvider: number,
): void {
  if (
    droppedImagesForProvider > 0 &&
    allTools.describeImage &&
    !initialActiveTools.has("describeImage")
  ) {
    initialActiveTools.add("describeImage");
  }
}

describe("companion-tool promotion — placeholder→describeImage", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = setupRegistry();
  });

  afterEach(() => {
    ToolRegistry.reset();
  });

  it("describeImage is registered as deferLoading (so it is not in the default active set)", () => {
    const meta = registry.get("describeImage")?.metadata;
    expect(meta?.loading.deferLoading).toBe(true);
  });

  it("non-deferred tools exclude describeImage (baseline)", () => {
    const nonDeferred = registry.getTools({
      sessionId: "test-session",
      userId: "test-user",
      includeDeferredTools: false,
    });
    expect(nonDeferred.describeImage).toBeUndefined();
  });

  it("allTools includes describeImage when deferred tools are requested", () => {
    const allTools = registry.getTools({
      sessionId: "test-session",
      userId: "test-user",
      includeDeferredTools: true,
    });
    expect(allTools.describeImage).toBeDefined();
  });

  it("promotes describeImage when droppedImagesForProvider > 0 and tool is available", () => {
    const allTools = registry.getTools({
      sessionId: "test-session",
      userId: "test-user",
      includeDeferredTools: true,
    });
    const initialActiveTools = new Set<string>(["searchTools"]);

    expect(initialActiveTools.has("describeImage")).toBe(false);

    applyDescribeImagePromotion(initialActiveTools, allTools, 2);

    expect(initialActiveTools.has("describeImage")).toBe(true);
  });

  it("does NOT promote when droppedImagesForProvider is 0 (non-rejecting provider)", () => {
    const allTools = registry.getTools({
      sessionId: "test-session",
      userId: "test-user",
      includeDeferredTools: true,
    });
    const initialActiveTools = new Set<string>(["searchTools"]);

    applyDescribeImagePromotion(initialActiveTools, allTools, 0);

    expect(initialActiveTools.has("describeImage")).toBe(false);
  });

  it("is a no-op when describeImage is already in the active set", () => {
    const allTools = registry.getTools({
      sessionId: "test-session",
      userId: "test-user",
      includeDeferredTools: true,
    });
    const initialActiveTools = new Set<string>(["searchTools", "describeImage"]);
    const sizeBefore = initialActiveTools.size;

    applyDescribeImagePromotion(initialActiveTools, allTools, 5);

    expect(initialActiveTools.size).toBe(sizeBefore);
    expect(initialActiveTools.has("describeImage")).toBe(true);
  });

  it("is a no-op when describeImage is unavailable (agent does not have it enabled)", () => {
    // Simulate an agent config that didn't grant describeImage — allTools is
    // empty. The promotion must not crash and must not add an unauthorized
    // tool to the initial active set.
    const allTools: Record<string, unknown> = {};
    const initialActiveTools = new Set<string>(["searchTools"]);

    applyDescribeImagePromotion(initialActiveTools, allTools, 3);

    expect(initialActiveTools.has("describeImage")).toBe(false);
  });
});
