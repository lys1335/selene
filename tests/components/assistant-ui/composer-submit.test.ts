import { describe, expect, it } from "vitest";

import { buildSimpleComposerSubmission } from "@/components/assistant-ui/composer-submit";

describe("buildSimpleComposerSubmission", () => {
  it("submits the visible composer text even when stale enhancement state exists", () => {
    expect(
      buildSimpleComposerSubmission({
        inputValue: "Ship the changelog update",
        enhancedContext:
          "Generated planning text\n[Base64 image data removed - use image URL instead]",
      }),
    ).toBe("Ship the changelog update");
  });

  it("prepends unified capture metadata without mutating the typed message", () => {
    expect(
      buildSimpleComposerSubmission({
        inputValue: "Summarize the issue",
        captureMetadata: {
          activeAppName: "Chrome",
          activeWindowTitle: "Bug report",
          browserUrl: "https://example.com/bug",
        },
      }),
    ).toBe(
      "[Screen Context: Chrome — Bug report]\n[URL: https://example.com/bug]\n\nSummarize the issue",
    );
  });
});
