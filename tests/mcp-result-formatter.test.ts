import { afterEach, describe, expect, it, vi } from "vitest";

import { clearTruncatedContentSession } from "@/lib/ai/truncated-content-store";

const mocks = vi.hoisted(() => ({
  saveBase64Image: vi.fn().mockResolvedValue({
    url: "/api/media/test.png",
    localPath: "session/generated/test.png",
  }),
  saveBase64Video: vi.fn().mockResolvedValue({
    url: "/api/media/test.mp4",
    localPath: "session/generated/test.mp4",
  }),
}));

vi.mock("@/lib/storage/local-storage", () => ({
  saveBase64Image: mocks.saveBase64Image,
  saveBase64Video: mocks.saveBase64Video,
  getFullPath: vi.fn((relativePath: string) => `/abs/${relativePath}`),
}));

import { formatMCPToolResult } from "@/lib/mcp/result-formatter";

describe("formatMCPToolResult", () => {
  afterEach(() => {
    clearTruncatedContentSession("session-2");
    clearTruncatedContentSession("session-3");
  });
  it("converts MCP image data URLs to stored URLs", async () => {
    const result = {
      content: [
        {
          type: "image",
          data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
          mimeType: "image/png",
        },
        { type: "text", text: "Screenshot captured" },
      ],
    };

    const formatted = await formatMCPToolResult(
      "chrome-devtools",
      "capture_screenshot",
      result,
      false,
      { sessionId: "session-1" }
    );

    expect(mocks.saveBase64Image).toHaveBeenCalledTimes(1);
    expect(formatted.images).toEqual([
      {
        url: "/api/media/test.png",
        localPath: "session/generated/test.png",
        filePath: "/abs/session/generated/test.png",
      },
    ]);
    expect(JSON.stringify(formatted)).not.toContain("base64,");
  });

  it("truncates oversized MCP text content and stores full content for retrieval", async () => {
    const formatted = await formatMCPToolResult(
      "ghostos",
      "ghost_read",
      "x".repeat(140_000),
      false,
      { sessionId: "session-2" }
    );

    expect(formatted.status).toBe("success");
    expect(formatted.isTruncated).toBe(true);
    expect(formatted.truncated).toBe(true);
    expect(typeof formatted.truncatedContentId).toBe("string");
    expect(typeof formatted.content).toBe("string");
    expect((formatted.content as string).length).toBeLessThan(140_000);
    expect(formatted.content).toContain("OUTPUT TRUNCATED");
  });

  it("truncates oversized MCP error strings", async () => {
    const formatted = await formatMCPToolResult(
      "ghostos",
      "ghost_read",
      "e".repeat(140_000),
      true,
      { sessionId: "session-3" }
    );

    expect(formatted.status).toBe("error");
    expect(formatted.isTruncated).toBe(true);
    expect(formatted.truncated).toBe(true);
    expect(typeof formatted.error).toBe("string");
    expect((formatted.error as string).length).toBeLessThan(140_000);
    expect(formatted.error).toContain("OUTPUT TRUNCATED");
  });
});
