/**
 * W3.3 — Reference-image overlay tests.
 *
 * Directly tests `buildCompiledPreviewHtml` — no esbuild / Tailwind /
 * postcss — so the suite runs in millisecond-scale and stays independent
 * of the Sprint 1 preview HTML structure tests.
 *
 * What these prove:
 *   1. Omitting `referenceImageUrl` emits zero overlay markup and keeps
 *      the historical `<body>` structure intact.
 *   2. Passing `referenceImageUrl` injects a single overlay root with the
 *      stable `data-design-reference-overlay` attribute, default opacity
 *      0.4, an <img> with `object-fit: contain` + `pointer-events: none`
 *      on the root, plus the three controls (opacity slider, blend-mode
 *      select, show/hide toggle) wired through vanilla JS.
 *   3. The overlay does NOT interfere with `previewTheme` rendering —
 *      the `.dark` class + the "system" IIFE script + the color-scheme
 *      meta survive the overlay injection.
 *   4. Load failures are probeable client-side via
 *      `data-design-reference-error="true"` (the JS emits an error listener).
 *
 * Mocks are limited to the transitively-imported logging + sqlite
 * modules so the compiler file can load cleanly under vitest.
 */

import { describe, it, expect, vi } from "vitest";

// Logging pulls `sqlite-client` transitively; stub defensively so the
// compiler module loads cleanly.
vi.mock("@/lib/ai/tool-registry/logging", () => ({
  logToolEvent: vi.fn(),
}));
vi.mock("@/lib/db/sqlite-client", () => ({
  db: {},
}));
vi.mock("@/lib/db/sqlite-character-schema", () => ({
  agentSyncFiles: {},
}));

const { buildCompiledPreviewHtml } = await import("../compiler");

const FAKE_JS = "/* compiled-js */ console.log('ok');";
const FAKE_CSS = "/* tailwind */\n.text-red-500 { color: red; }";
const TITLE = "Reference Overlay Test";

describe("W3.3 buildCompiledPreviewHtml — reference image overlay", () => {
  it("does NOT emit the overlay when referenceImageUrl is undefined", () => {
    const html = buildCompiledPreviewHtml(FAKE_JS, FAKE_CSS, TITLE, "dark");

    // Ambient preview structure preserved (Sprint 1/2 invariant).
    expect(html).toContain('<div id="selene-design-preview-root"></div>');
    expect(html).toContain('<html lang="en" class="dark">');
    expect(html).toContain('<meta name="color-scheme" content="light dark"');

    // No overlay markers at all.
    expect(html).not.toContain("data-design-reference-overlay");
    expect(html).not.toContain("selene-design-reference-overlay");
    expect(html).not.toContain("data-design-reference-controls");
    expect(html).not.toContain("data-design-reference-image");
  });

  it("injects an overlay with default opacity 0.4, pointer-events none, and all three controls", () => {
    const url = "https://cdn.example.com/figma-frame.png";
    const html = buildCompiledPreviewHtml(
      FAKE_JS,
      FAKE_CSS,
      TITLE,
      "dark",
      undefined,
      url,
    );

    // Root overlay element with the stable testability attribute.
    expect(html).toContain("data-design-reference-overlay");
    expect(html).toContain('id="selene-design-reference-overlay"');

    // Pointer events disabled on the root so it never blocks clicks.
    expect(html).toMatch(
      /data-design-reference-overlay[^>]*style="[^"]*pointer-events:none[^"]*"/,
    );

    // Image element uses object-fit: contain + opacity 0.4 by default.
    expect(html).toContain("data-design-reference-image");
    expect(html).toMatch(/data-design-reference-image[^>]*src="https:\/\/cdn\.example\.com\/figma-frame\.png"/);
    expect(html).toMatch(/data-design-reference-image[^>]*style="[^"]*object-fit:contain[^"]*"/);
    expect(html).toMatch(/data-design-reference-image[^>]*style="[^"]*opacity:0\.4[^"]*"/);

    // Control panel + the three controls.
    expect(html).toContain("data-design-reference-controls");
    expect(html).toContain("data-design-reference-opacity");
    expect(html).toContain("data-design-reference-blend");
    expect(html).toContain("data-design-reference-toggle");

    // Blend-mode select must carry both Figma-compare gold-standard options.
    expect(html).toMatch(/<option value="normal">normal<\/option>/);
    expect(html).toMatch(/<option value="difference">difference<\/option>/);

    // Opacity slider default value is 40 (→ 0.4 when scaled by /100).
    expect(html).toMatch(/data-design-reference-opacity[^>]*value="40"/);

    // Error-handling listener for client-side failure probing.
    expect(html).toContain("'data-design-reference-error'");
  });

  it("HTML-escapes the reference image URL to avoid attribute injection", () => {
    // Quote + bracket inside the URL should be escaped so they can't close
    // the `<img src="...">` attribute or start a new element.
    const maliciousUrl = 'https://evil.example.com/"><script>alert(1)</script>';
    const html = buildCompiledPreviewHtml(
      FAKE_JS,
      FAKE_CSS,
      TITLE,
      "dark",
      undefined,
      maliciousUrl,
    );

    // The raw </script> + quote must NOT appear inside the <img> attribute.
    const imgTag = html.match(/<img[^>]*data-design-reference-image[^>]*>/);
    expect(imgTag).toBeTruthy();
    expect(imgTag?.[0]).not.toContain("<script>");
    // And the HTML-escaped form of the double quote should be present.
    expect(imgTag?.[0]).toContain("&quot;");
  });

  it("does NOT interfere with the 'dark' previewTheme html tag", () => {
    const html = buildCompiledPreviewHtml(
      FAKE_JS,
      FAKE_CSS,
      TITLE,
      "dark",
      undefined,
      "/api/media/ref.png",
    );

    // The <html class="dark"> tag is the hook Tailwind's `darkMode: "class"`
    // config reacts to. Overlay injection must NOT displace it.
    expect(html).toContain('<html lang="en" class="dark">');

    // Overlay lives in <body>, head remains intact.
    expect(html).toMatch(/<head>[\s\S]*<\/head>/);
    expect(html).toContain('<meta name="color-scheme" content="light dark"');

    // Both overlay root AND the preview root must be present in the body.
    expect(html).toContain("data-design-reference-overlay");
    expect(html).toContain('<div id="selene-design-preview-root"></div>');
  });

  it("does NOT interfere with the 'system' previewTheme IIFE", () => {
    const html = buildCompiledPreviewHtml(
      FAKE_JS,
      FAKE_CSS,
      TITLE,
      "system",
      undefined,
      "/api/media/ref.png",
    );

    // The "system" variant emits <html lang="en"> (no class) + the IIFE
    // that toggles `.dark` based on prefers-color-scheme.
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("classList.toggle('dark'");

    // Overlay still rendered.
    expect(html).toContain("data-design-reference-overlay");
  });

  it("does NOT interfere with the 'light' previewTheme", () => {
    const html = buildCompiledPreviewHtml(
      FAKE_JS,
      FAKE_CSS,
      TITLE,
      "light",
      undefined,
      "/api/media/ref.png",
    );

    // Light theme → no `.dark` class on <html>, no IIFE script.
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('class="dark"');
    expect(html).not.toContain("prefers-color-scheme:dark");

    // Overlay still rendered.
    expect(html).toContain("data-design-reference-overlay");
  });

  it("accepts a /api/media/... synced-media URL and emits it verbatim", () => {
    const url = "/api/media/uploads/2026/reference.png";
    const html = buildCompiledPreviewHtml(
      FAKE_JS,
      FAKE_CSS,
      TITLE,
      "dark",
      undefined,
      url,
    );
    expect(html).toMatch(/src="\/api\/media\/uploads\/2026\/reference\.png"/);
  });
});
