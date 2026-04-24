import { describe, expect, it } from "vitest";

import {
  INLINE_PASSTHROUGH_TOKENS,
  MAX_STREAM_TOOL_RESULT_TOKENS,
  MID_TIER_PREVIEW_TOKENS,
  PREVIEW_TIER_TOKENS,
  guardToolResultForStreaming,
} from "@/lib/ai/tool-result-stream-guard";

// Helpers --------------------------------------------------------------------

/** Produce a string sized to a specific estimated-token count (~4 chars/tok). */
function textOfTokens(tokens: number): string {
  return "x".repeat(tokens * 4);
}

describe("guardToolResultForStreaming — tiering", () => {
  it("passes small tool results through unchanged (≤ INLINE_PASSTHROUGH_TOKENS)", () => {
    const result = { status: "success", content: "ok" };

    const guarded = guardToolResultForStreaming("localGrep", result);

    expect(guarded.blocked).toBe(false);
    expect(guarded.result).toEqual(result);
    expect(guarded.estimatedTokens).toBeLessThan(INLINE_PASSTHROUGH_TOKENS);
  });

  it("MID-tier output (10K < t ≤ 25K) produces a stub with preview", () => {
    // ~12K tokens worth of stdout
    const mid = textOfTokens(12_000);
    const result = {
      status: "success",
      stdout: mid,
      stderr: "",
      exitCode: 0,
      logId: "log_mid",
    };

    const guarded = guardToolResultForStreaming("executeCommand", result);

    expect(guarded.blocked).toBe(true);
    expect(guarded.estimatedTokens).toBeGreaterThan(INLINE_PASSTHROUGH_TOKENS);
    expect(guarded.estimatedTokens).toBeLessThanOrEqual(PREVIEW_TIER_TOKENS);

    const truncated = guarded.result as Record<string, unknown>;
    expect(truncated.status).toBe("success");
    expect(truncated.exitCode).toBe(0);
    expect(truncated.isTruncated).toBe(true);

    const stdout = String(truncated.stdout);
    expect(stdout).toContain("[STUB:");
    expect(stdout).toContain("tool=executeCommand");
    expect(stdout).toContain("logId=log_mid");
    expect(stdout).toContain("Preview");
    expect(stdout).toContain("Outline:");
    expect(stdout).toContain("Retrieval:");
    expect(stdout).toContain("readLog");

    // Must be significantly smaller than the original.
    expect(stdout.length).toBeLessThan(mid.length);
  });

  it("HIGH-tier output (> 25K) produces a stub-only (no preview) with retrieval commands", () => {
    const huge = textOfTokens(40_000);
    const result = {
      status: "success",
      stdout: huge,
      stderr: "",
      exitCode: 0,
      logId: "log_huge",
    };

    const guarded = guardToolResultForStreaming("executeCommand", result);

    expect(guarded.blocked).toBe(true);
    expect(guarded.estimatedTokens).toBeGreaterThan(PREVIEW_TIER_TOKENS);

    const truncated = guarded.result as Record<string, unknown>;
    const stdout = String(truncated.stdout);
    expect(stdout).toContain("[STUB:");
    expect(stdout).toContain("logId=log_huge");
    expect(stdout).toContain("Outline:");
    expect(stdout).toContain("Retrieval:");
    // No preview section in the top tier.
    expect(stdout).not.toContain("Preview (first");

    // Stub total length should be a tiny fraction of the original.
    expect(stdout.length).toBeLessThan(huge.length / 10);
  });

  it("prefers logId over truncatedContentId in the retrieval line", () => {
    const result = {
      status: "success",
      stdout: "line\n".repeat(60_000),
      logId: "log_abc",
      truncatedContentId: "trunc_xyz",
    };

    const guarded = guardToolResultForStreaming("executeCommand", result);

    expect(guarded.blocked).toBe(true);
    const stdout = String((guarded.result as Record<string, unknown>).stdout);
    expect(stdout).toContain("logId=log_abc");
    expect(stdout).toContain("readLog");
  });

  it("falls back to truncatedContentId when logId is absent", () => {
    const result = {
      content: "y".repeat(200_000),
      truncatedContentId: "trunc_only",
    };

    const guarded = guardToolResultForStreaming("webSearch", result);

    expect(guarded.blocked).toBe(true);
    const content = String((guarded.result as Record<string, unknown>).content);
    expect(content).toContain("contentId=trunc_only");
    expect(content).toContain("retrieveFullContent");
  });

  it("handles MCP content arrays by replacing the first text item with the stub", () => {
    const result = {
      content: [
        { type: "text", text: "x".repeat(200_000) },
        { type: "image", url: "https://example.com/img.png" },
      ],
    };

    const guarded = guardToolResultForStreaming("mcpTool", result);

    expect(guarded.blocked).toBe(true);
    const truncated = guarded.result as Record<string, unknown>;
    const contentArr = truncated.content as any[];
    expect(contentArr[0].text).toContain("[STUB:");
    expect(contentArr[0].text.length).toBeLessThan(200_000);
    // Non-text items must be preserved.
    expect(contentArr[1]).toEqual({ type: "image", url: "https://example.com/img.png" });
  });

  it("handles string results by replacing the whole string with the stub", () => {
    const huge = "y".repeat(200_000);

    const guarded = guardToolResultForStreaming("someTool", huge);

    expect(guarded.blocked).toBe(true);
    expect(typeof guarded.result).toBe("string");
    expect((guarded.result as string)).toContain("[STUB:");
    expect((guarded.result as string).length).toBeLessThan(huge.length);
  });

  it("exposes tier thresholds as stable exports", () => {
    expect(INLINE_PASSTHROUGH_TOKENS).toBe(10_000);
    expect(PREVIEW_TIER_TOKENS).toBe(25_000);
    expect(MID_TIER_PREVIEW_TOKENS).toBe(1_500);
    expect(MAX_STREAM_TOOL_RESULT_TOKENS).toBe(25_000);
  });
});
