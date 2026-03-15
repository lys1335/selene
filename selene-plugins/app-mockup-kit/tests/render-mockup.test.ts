import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import { parseArgs } from "../scripts/render-mockup.js";
import { listPresets, renderMockup } from "../scripts/mockup-core.js";

describe("app mockup kit", () => {
it("listPresets exposes the supported deterministic presets", () => {
  expect(listPresets()).toEqual([
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

it("parseArgs reads the required flags and optional styling", () => {
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

  expect(options.input).toBe("./shot.png");
  expect(options.output).toBe("./out/mockup.svg");
  expect(options.preset).toBe("browser-chrome");
  expect(options.title).toBe("Launch Week");
  expect(options.subtitle).toBe("A better mockup flow");
  expect(options.url).toBe("example.app");
  expect(options.background).toBe("solid:#ffffff");
  expect(options.padding).toBe(80);
  expect(options.shadow).toBe("soft");
});

it("renderMockup writes a self-contained svg mockup", async () => {
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
  expect(result.outputPath).toBe(outputPath);
  expect(svg).toMatch(/<svg[\s\S]*<image href="data:image\/png;base64,/);
  expect(svg).toMatch(/Inbox, rethought/);
  expect(svg).toMatch(/Deterministic output/);
  expect(svg).toMatch(/linearGradient/);
  expect(svg).toMatch(/<g transform="translate\(64, 194\)">/);
  expect(svg).toMatch(/<clipPath id="display-clip-iphone-14-pro">[\s\S]*<rect x="19" y="19" width="390" height="830" rx="49" ry="49"/);
  expect(svg).toMatch(/<image href="data:image\/png;base64,[^"]+" x="19" y="19" width="390" height="830" preserveAspectRatio="xMidYMid slice" clip-path="url\(#display-clip-iphone-14-pro\)"/);
  expect(svg).toMatch(/<rect x="154" y="29" width="120" height="35" rx="20" fill="#010101"/);
});
});
