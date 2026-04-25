import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/local-storage", () => ({
  saveFile: vi.fn(),
}));

import { injectCspMeta, waitForPageReady } from "../export";

describe("preview-ready capture helpers", () => {
  it("injects CSP outside scripts when sanitized HTML no longer has a real <head>", () => {
    const html = [
      "<!doctype html>",
      '<div id="selene-design-preview-root"></div>',
      `<script>`,
      `const message = "React expected a <head> element to exist.";`,
      `document.getElementById("selene-design-preview-root")?.setAttribute("data-preview-ready", "true");`,
      `</script>`,
    ].join("\n");

    const withCsp = injectCspMeta(html);
    const scriptBody = withCsp.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? "";

    expect(withCsp).toContain("Content-Security-Policy");
    expect(withCsp.indexOf("Content-Security-Policy")).toBeLessThan(withCsp.indexOf("<script>"));
    expect(scriptBody).toContain("React expected a <head> element to exist.");
    expect(scriptBody).not.toContain("Content-Security-Policy");
  });

  it("fast-fails preview readiness with an actionable diagnostic", async () => {
    const cause = new Error("Waiting failed: 30000ms exceeded");
    const page = {
      waitForFunction: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(cause),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };

    await expect(waitForPageReady(page as never)).rejects.toMatchObject({
      message: "Preview never signaled ready within 30000ms — see [preview-console] logs above.",
      cause,
    });
    expect(page.waitForFunction).toHaveBeenLastCalledWith(expect.any(Function), { timeout: 30_000 });
  });
});
