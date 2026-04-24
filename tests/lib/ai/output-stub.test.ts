import { describe, expect, it } from "vitest";

import { buildOutputStub, deriveOutline } from "@/lib/ai/output-stub";

describe("deriveOutline", () => {
  it("returns empty outline for empty input", () => {
    const outline = deriveOutline("");
    expect(outline.lineCount).toBe(0);
    expect(outline.format).toBe("empty");
    expect(outline.estimatedTokens).toBe(0);
  });

  it("counts lines and tokens for text input", () => {
    const text = "hello\nworld\nthis is a test";
    const outline = deriveOutline(text);
    expect(outline.lineCount).toBe(3);
    expect(outline.format).toBe("text");
    expect(outline.firstLine).toBe("hello");
    expect(outline.lastLine).toBe("this is a test");
    expect(outline.estimatedTokens).toBeGreaterThan(0);
  });

  it("detects top-level JSON keys", () => {
    const text = JSON.stringify({ status: "ok", items: [1, 2, 3], error: null });
    const outline = deriveOutline(text);
    expect(outline.format).toBe("json");
    expect(outline.topLevelKeys).toEqual(["status", "items", "error"]);
  });

  it("detects JSON arrays", () => {
    const outline = deriveOutline("[1,2,3,4,5]");
    expect(outline.format).toBe("json");
    expect(outline.topLevelKeys).toEqual(["array[5]"]);
  });

  it("captures stderr line count when provided", () => {
    const outline = deriveOutline("stdout line", { stderr: "err1\nerr2\nerr3" });
    expect(outline.stderrLineCount).toBe(3);
  });

  it("handles non-JSON that starts with { (graceful fallback)", () => {
    const outline = deriveOutline("{ this is not json\nmore text");
    expect(outline.format).toBe("text");
  });
});

describe("buildOutputStub", () => {
  it("includes header, outline and retrieval for high-tier output", () => {
    const text = "line1\nline2\nline3";
    const stub = buildOutputStub({
      toolName: "executeCommand",
      originalText: text,
      retrievalId: "abc123",
      idType: "logId",
      previewTokens: 0,
    });

    expect(stub).toContain("[STUB: tool=executeCommand");
    expect(stub).toContain("logId=abc123");
    expect(stub).toContain("Outline:");
    expect(stub).toContain("Lines: 3");
    expect(stub).toContain("Retrieval:");
    expect(stub).toContain(`executeCommand({ command: "readLog", logId: "abc123", head: 100 })`);
    expect(stub).toContain(`executeCommand({ command: "readLog", logId: "abc123", tail: 100 })`);
    expect(stub).toContain(`executeCommand({ command: "readLog", logId: "abc123", range: [400, 500] })`);
    expect(stub).toContain(`executeCommand({ command: "readLog", logId: "abc123", grep: "error" })`);
    expect(stub).not.toContain("Preview");
  });

  it("includes preview section when previewTokens > 0", () => {
    const text = "a\nb\nc\nd\ne";
    const stub = buildOutputStub({
      toolName: "executeCommand",
      originalText: text,
      retrievalId: "log_xyz",
      idType: "logId",
      previewTokens: 500,
    });
    expect(stub).toContain("Preview (first");
    // The preview budget (500 tokens × 4 chars) exceeds total text — full text shown.
    expect(stub).toContain("a\nb\nc\nd\ne");
  });

  it("uses retrieveFullContent invocation when idType is contentId", () => {
    const stub = buildOutputStub({
      toolName: "webSearch",
      originalText: "foo\nbar",
      retrievalId: "trunc_abc",
      idType: "contentId",
    });
    expect(stub).toContain("contentId=trunc_abc");
    expect(stub).toContain(`retrieveFullContent({ contentId: "trunc_abc", head: 100 })`);
    expect(stub).toContain(`retrieveFullContent({ contentId: "trunc_abc", grep: "error" })`);
    expect(stub).not.toContain("readLog");
  });

  it("warns when no retrieval ID is available", () => {
    const stub = buildOutputStub({
      toolName: "someTool",
      originalText: "foo",
      retrievalId: undefined,
    });
    expect(stub).toContain("Full output NOT stored");
  });

  it("preview is head-only — tail lines are NOT in the preview section", () => {
    // Build a long text where the last line is clearly distinct.
    const head = Array.from({ length: 1_000 }, (_, i) => `line ${i}`).join("\n");
    const text = head + "\nMARKER_AT_TAIL";
    const stub = buildOutputStub({
      toolName: "executeCommand",
      originalText: text,
      retrievalId: "log_x",
      idType: "logId",
      // Small preview so the tail is outside of budget.
      previewTokens: 200,
    });

    // Isolate the preview section — it ends at the Outline header.
    const previewStart = stub.indexOf("Preview (first");
    expect(previewStart).toBeGreaterThan(-1);
    const outlineStart = stub.indexOf("Outline:");
    const previewBody = stub.slice(previewStart, outlineStart);

    // Preview must show head lines, not the tail marker.
    expect(previewBody).toContain("line 0");
    expect(previewBody).not.toContain("MARKER_AT_TAIL");

    // The outline will still reference the last line — that's by design.
    expect(stub).toContain("Last line:");
  });
});
