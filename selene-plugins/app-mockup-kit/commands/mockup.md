---
description: Render deterministic browser or device mockups from screenshots using the local TypeScript CLI in this plugin.
disable-model-invocation: true
---

Use this command when a user already has one or more real screenshots and wants a framed app mockup without ML image generation.

Preferred flow:
1. Confirm or infer the source screenshot path.
2. Pick the closest preset for the request.
3. Run:
   `npm --prefix selene-plugins/app-mockup-kit run render -- --input <path-or-url> --output <output.svg> --preset <preset>`
4. Return the output path plus the preset used.

Common presets:
- `browser-chrome`
- `browser-safari`
- `iphone-14-pro`
- `pixel-6-pro`
- `ipad-pro`
- `macbook-pro`
- `window`
- `plain`

Useful flags:
- `--title "Launch Week"`
- `--subtitle "New analytics dashboard"`
- `--url "selene.sh/pricing"`
- `--background "gradient:#0f172a,#2563eb"`
- `--padding 72`
- `--shadow lifted`

If the source is a webpage URL rather than an image, capture a screenshot first with the host agent's browser tooling, then pass the saved screenshot into the renderer.
