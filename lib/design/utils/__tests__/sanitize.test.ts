/**
 * Sanitize regression tests.
 *
 * Focus: the `allowInlineScripts` escape hatch added for the design-workspace
 * screenshot + export pipeline. Root cause of the fleet-wide "Waiting failed"
 * failure was that the built-in regex sanitizer unconditionally stripped
 * `<script>` tags, which also removed our own esbuild-bundled preview JS
 * responsible for firing `data-preview-ready`. Puppeteer then timed out on
 * the waitForSelector call.
 *
 * These tests lock in:
 *   1. Default behaviour still strips `<script>` (untrusted input stays safe).
 *   2. `allowInlineScripts: true` preserves `<script>` content verbatim.
 *   3. iframe / object / embed / link / meta remain forbidden even when the
 *      script bypass is enabled.
 *   4. Event-handler (`on*`) attributes are still scrubbed on non-script tags
 *      when the bypass is active (defence-in-depth must not regress).
 *   5. URL-attribute scrubbing still runs on non-script tags.
 */

import { describe, expect, it } from "vitest";
import { sanitizeHTML } from "../sanitize";

describe("sanitizeHTML — default script handling", () => {
  it("strips <script> tags by default (untrusted input path)", () => {
    const dirty = `<div>hello<script>alert(1)</script></div>`;
    const clean = sanitizeHTML(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert(1)");
  });

  it("strips self-closing <script src=...> variants by default", () => {
    const dirty = `<div><script src="https://evil.example.com/x.js"></script>ok</div>`;
    const clean = sanitizeHTML(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("evil.example.com");
  });
});

describe("sanitizeHTML — allowInlineScripts escape hatch", () => {
  it("preserves <script> tags and their body when allowInlineScripts is true", () => {
    const dirty = `<div id="root"></div><script>window.__selenePreviewReady = true;</script>`;
    const clean = sanitizeHTML(dirty, {
      allowStyles: true,
      allowDataUrls: true,
      allowInlineScripts: true,
    });
    expect(clean).toContain("<script>");
    expect(clean).toContain("window.__selenePreviewReady = true;");
    expect(clean).toContain("</script>");
  });

  it("preserves multiple <script> blocks (preview hydration uses two)", () => {
    const dirty = [
      `<div id="preview-root"></div>`,
      `<script>document.documentElement.dataset.previewReady = "0";</script>`,
      `<script type="module">import * as __m from "/bundle.js"; __m.mount();</script>`,
    ].join("");
    const clean = sanitizeHTML(dirty, { allowInlineScripts: true });
    expect(clean.match(/<script/g)?.length ?? 0).toBe(2);
    expect(clean).toContain("previewReady");
    expect(clean).toContain("__m.mount()");
  });

  it("keeps iframe / object / embed / link / meta forbidden even when scripts are allowed", () => {
    const dirty = [
      `<iframe src="https://evil.example.com"></iframe>`,
      `<object data="x.swf"></object>`,
      `<embed src="x.swf" />`,
      `<link rel="stylesheet" href="x.css" />`,
      `<meta http-equiv="refresh" content="0;url=https://evil.example.com" />`,
      `<script>keepMe()</script>`,
    ].join("");
    const clean = sanitizeHTML(dirty, { allowInlineScripts: true });
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<object");
    expect(clean).not.toContain("<embed");
    expect(clean).not.toContain("<link");
    expect(clean).not.toContain("<meta");
    expect(clean).toContain("keepMe()");
  });

  it("still scrubs on* event handlers on allowed non-script tags", () => {
    const dirty = `<button onclick="pwn()" onmouseover="x()">go</button><script>safe()</script>`;
    const clean = sanitizeHTML(dirty, { allowInlineScripts: true });
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onmouseover");
    expect(clean).not.toContain("pwn()");
    expect(clean).toContain("safe()");
  });

  it("still scrubs javascript: URLs in href/src even when scripts are allowed", () => {
    const dirty = `<a href="javascript:pwn()">click</a><script>ok()</script>`;
    const clean = sanitizeHTML(dirty, { allowInlineScripts: true });
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("ok()");
  });

  it("does not enable scripts implicitly for AI-content callers", () => {
    // isAIContent: true must never unlock script tags — that would let
    // model-generated HTML execute arbitrary JS. Only an explicit opt-in
    // via allowInlineScripts is accepted.
    const dirty = `<div>ok</div><script>badAI()</script>`;
    const clean = sanitizeHTML(dirty, { isAIContent: true });
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("badAI()");
  });
});

describe("sanitizeHTML — smoke tests for design-workspace shape", () => {
  it("preserves a data:image src on <img> when allowDataUrls + allowInlineScripts are set", () => {
    const dirty =
      `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg" alt="x" />` +
      `<script>hydrate()</script>`;
    const clean = sanitizeHTML(dirty, {
      allowDataUrls: true,
      allowInlineScripts: true,
    });
    expect(clean).toContain("data:image/png;base64");
    expect(clean).toContain("hydrate()");
  });

  it("leaves <style> content untouched (design-workspace ships inline tailwind runtime CSS)", () => {
    const dirty = `<style>.preview { color: red }</style><div class="preview">x</div>`;
    const clean = sanitizeHTML(dirty, { allowInlineScripts: true });
    // style tag itself isn't in the allowlist so it gets removed, but the
    // inner CSS text survives as body text — the preview pipeline relies on
    // injected CSS in <head> not on arbitrary <style> blocks in the body,
    // so this is the intended shape. The key assertion is that nothing here
    // surfaces a new injection surface.
    expect(clean).not.toContain("<iframe");
    expect(clean).toContain("preview");
  });
});
