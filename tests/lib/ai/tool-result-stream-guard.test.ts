import { describe, expect, it } from "vitest";

import {
  MAX_STREAM_TOOL_RESULT_TOKENS,
  MIN_STREAM_TOOL_RESULT_TOKENS,
  guardToolResultForStreaming,
} from "@/lib/ai/tool-result-stream-guard";

describe("guardToolResultForStreaming", () => {
  it("keeps small tool results unchanged", () => {
    const result = { status: "success", content: "ok" };

    const guarded = guardToolResultForStreaming("localGrep", result, {
      maxTokens: 2_000,
    });

    expect(guarded.blocked).toBe(false);
    expect(guarded.result).toEqual(result);
    expect(guarded.estimatedTokens).toBeLessThanOrEqual(2_000);
  });

  it("truncates oversized output with head+tail instead of blocking entirely", () => {
    const huge = "x".repeat(140_000);
    const result = {
      status: "success",
      stdout: huge,
      stderr: "",
      exitCode: 0,
      executionTime: 42,
      logId: "log_huge",
      truncatedContentId: "trunc_abc123",
    };

    const guarded = guardToolResultForStreaming("executeCommand", result, {
      maxTokens: 3_000,
      metadata: { sourceFileName: "executor.ts" },
    });

    expect(guarded.blocked).toBe(true);
    const truncated = guarded.result as Record<string, unknown>;
    // Should preserve the result structure, not replace with error
    expect(truncated.status).toBe("success");
    expect(truncated.exitCode).toBe(0);
    expect(truncated.isTruncated).toBe(true);
    // stdout should contain head+tail truncation marker
    expect(String(truncated.stdout)).toContain("TRUNCATED");
    expect(String(truncated.stdout)).toContain("showing head + tail");
    // Should include retrieval notice with logId
    expect(String(truncated.stdout)).toContain("readLog");
    expect(String(truncated.stdout)).toContain("log_huge");
    // Should be significantly smaller than original
    expect(String(truncated.stdout).length).toBeLessThan(huge.length);
  });

  it("preserves logId and truncatedContentId in retrieval notice", () => {
    const result = {
      status: "success",
      stdout: "line\n".repeat(50_000),
      logId: "log_abc",
      truncatedContentId: "trunc_xyz",
    };

    const guarded = guardToolResultForStreaming("executeCommand", result, {
      maxTokens: 5_000,
    });

    expect(guarded.blocked).toBe(true);
    const truncated = guarded.result as Record<string, unknown>;
    expect(String(truncated.stdout)).toContain("log_abc");
  });

  it("normalizes very small maxTokens floor", () => {
    const result = { status: "success", content: "x".repeat(20_000) };

    const guarded = guardToolResultForStreaming("localGrep", result, {
      maxTokens: 1,
    });

    expect(guarded.blocked).toBe(true);
    // With maxTokens=1, the content should still be truncated (not an error)
    const truncated = guarded.result as Record<string, unknown>;
    expect(truncated.isTruncated).toBe(true);
  });

  it("caps explicit maxTokens to the hard stream limit", () => {
    const huge = { status: "success", content: "x".repeat(200_000) };

    const guarded = guardToolResultForStreaming("localGrep", huge, {
      maxTokens: 120_000,
    });

    expect(guarded.blocked).toBe(true);
  });

  it("uses hard stream limit when maxTokens is missing", () => {
    const huge = { status: "success", content: "x".repeat(200_000) };

    const guarded = guardToolResultForStreaming("executeCommand", huge);

    expect(guarded.blocked).toBe(true);
  });

  it("uses hard stream limit for localGrep when maxTokens is missing", () => {
    const huge = { status: "success", content: "x".repeat(200_000) };

    const guarded = guardToolResultForStreaming("localGrep", huge);

    expect(guarded.blocked).toBe(true);
  });

  it("handles MCP content arrays by truncating text items", () => {
    const result = {
      content: [
        { type: "text", text: "x".repeat(200_000) },
        { type: "image", url: "https://example.com/img.png" },
      ],
    };

    const guarded = guardToolResultForStreaming("mcpTool", result, {
      maxTokens: 5_000,
    });

    expect(guarded.blocked).toBe(true);
    const truncated = guarded.result as Record<string, unknown>;
    const contentArr = truncated.content as any[];
    expect(contentArr[0].text.length).toBeLessThan(200_000);
    expect(contentArr[0].text).toContain("TRUNCATED");
    // Non-text items should be preserved
    expect(contentArr[1]).toEqual({ type: "image", url: "https://example.com/img.png" });
  });

  it("handles string results by truncating directly", () => {
    const huge = "y".repeat(200_000);

    const guarded = guardToolResultForStreaming("someTool", huge, {
      maxTokens: 3_000,
    });

    expect(guarded.blocked).toBe(true);
    expect(typeof guarded.result).toBe("string");
    expect((guarded.result as string).length).toBeLessThan(200_000);
    expect(guarded.result as string).toContain("TRUNCATED");
  });
});
