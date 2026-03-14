# app-mockup-kit

A standalone agent plugin package for deterministic app mockups.

It gives any host agent a terminal-first renderer plus a reusable `SKILL.md` workflow for turning real screenshots into framed browser, phone, tablet, laptop, or plain mockups without ML image generation.

## Why this exists

Most agent-friendly image workflows today either:
- depend on browser UIs like Screenshot.rocks, or
- jump straight to generative image tools

This package keeps the pipeline deterministic:
1. capture or receive a real screenshot
2. choose a preset
3. render a local SVG mockup from the terminal

## Package layout

```text
app-mockup-kit/
├── .claude-plugin/plugin.json
├── commands/mockup.md
├── skills/app-mockup/SKILL.md
├── scripts/mockup-core.ts
├── scripts/render-mockup.ts
├── references/screenshot-rocks-review.md
├── tests/render-mockup.test.ts
├── package.json
└── tsconfig.json
```

## Install

This is a standalone external package. Drop it into any compatible plugin directory or keep it in your repo and call it with `npm --prefix`.

```bash
npm --prefix selene-plugins/app-mockup-kit install
```

## Render a mockup

```bash
npm --prefix selene-plugins/app-mockup-kit run render -- \
  --input ./examples/dashboard.png \
  --output ./out/dashboard-browser.svg \
  --preset browser-chrome \
  --url selene.so/dashboard \
  --background gradient:#0f172a,#2563eb \
  --padding 72 \
  --shadow lifted
```

## Supported presets

- `browser-chrome`
- `browser-safari`
- `iphone-14-pro`
- `pixel-6-pro`
- `ipad-pro`
- `macbook-pro`
- `window`
- `plain`

## Supported input types

- local image files such as `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`
- remote image URLs over `http` or `https`
- `data:` URLs

## Output

The renderer writes a self-contained SVG file with the source image embedded as a data URL.

That makes the output:
- portable
- deterministic
- easy to version
- host-agent agnostic

## Validate

```bash
npm --prefix selene-plugins/app-mockup-kit run validate
```
