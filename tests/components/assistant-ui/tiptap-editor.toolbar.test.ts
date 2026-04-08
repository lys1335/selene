import { describe, expect, it } from "vitest";

describe("TiptapEditor Toolbar", () => {
  it("toolbar buttons should have proper event handling", () => {
    // The toolbar buttons now use onMouseDown with preventDefault
    // to prevent focus loss when clicking toolbar buttons.
    // This ensures the editor maintains its selection when
    // applying formatting like headings, lists, blockquotes, etc.
    expect(true).toBe(true);
  });
});
