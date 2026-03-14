import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import { parseArgs } from "../scripts/render-mockup.js";
import { listPresets, renderMockup } from "../scripts/mockup-core.js";

test("listPresets exposes the supported deterministic presets", () => {
  assert.deepEqual(listPresets(), [
    "browser-chrome",
    "browser-safari",
    "iphone-14-pro",
    "pixel-6-pro",
    "ipad-pro",
    "macbook-pro",
    "window",
    "plain",
  ]);
});

test("parseArgs reads the required flags and optional styling", () => {
  const options = parseArgs([
    "--input", "./shot.png",
    "--output", "./out/mockup.svg",
    "--preset", "browser-chrome",
    "--title", "Launch Week",
    "--subtitle", "A better mockup flow",
    "--url", "example.app",
    "--background", "solid:#ffffff",
    "--padding", "80",
    "--shadow", "soft",
  ]);

  assert.equal(options.input, "./shot.png");
  assert.equal(options.output, "./out/mockup.svg");
  assert.equal(options.preset, "browser-chrome");
  assert.equal(options.title, "Launch Week");
  assert.equal(options.subtitle, "A better mockup flow");
  assert.equal(options.url, "example.app");
  assert.equal(options.background, "solid:#ffffff");
  assert.equal(options.padding, 80);
  assert.equal(options.shadow, "soft");
});

test("renderMockup writes a self-contained svg mockup", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "app-mockup-kit-"));
  const outputPath = path.join(tmpDir, "mockup.svg");
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4GkAAAAASUVORK5CYII=";

  const result = await renderMockup({
    input: tinyPng,
    output: outputPath,
    preset: "iphone-14-pro",
    title: "Inbox, rethought",
    subtitle: "Deterministic output",
    url: "ignored.example",
    background: "gradient:#111827,#1d4ed8",
    padding: 64,
    shadow: "lifted",
  });

  const svg = await readFile(outputPath, "utf8");
  assert.equal(result.outputPath, outputPath);
  assert.match(svg, /<svg[\s\S]*<image href="data:image\/png;base64,/);
  assert.match(svg, /Inbox, rethought/);
  assert.match(svg, /Deterministic output/);
  assert.match(svg, /linearGradient/);
  assert.match(svg, /<g transform="translate\(64, 194\)">/);
  assert.match(svg, /<clipPath id="display-clip-iphone-14-pro">[\s\S]*<rect x="19" y="19" width="390" height="830" rx="49" ry="49"/);
  assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="19" y="19" width="390" height="830" preserveAspectRatio="xMidYMid slice" clip-path="url\(#display-clip-iphone-14-pro\)"/);
  assert.match(svg, /<rect x="154" y="29" width="120" height="35" rx="20" fill="#010101"/);
});
