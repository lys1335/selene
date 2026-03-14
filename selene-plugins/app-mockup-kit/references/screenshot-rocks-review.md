# Screenshot.rocks review

This package intentionally does not embed the Screenshot.rocks app runtime.

What Screenshot.rocks contributes conceptually:
- deterministic framing for browser and device mockups
- a browser-first export path based on DOM composition
- preset-driven mockup customization instead of ML image generation

Why this package does not depend on it directly:
- the upstream project is a React 16 app with a browser-session ingest flow
- its extension/serverless path stores images in session storage before redirecting into the UI
- there is no stable terminal-first CLI for agent workflows

Useful upstream references inspected while designing this package:
- `src/utils/image.ts` uses `dom-to-image` for deterministic exports
- `src/components/common/Canvas/index.tsx` switches between browser/device/no-frame views
- `src/components/common/Frames/Browser/index.tsx` and `src/components/common/Frames/Phone/index.tsx` show the presentation-layer split we want for presets
- `src/stores/browserStore.ts` and `src/stores/phoneStore.ts` reveal a preset/theme model that maps well to agent-facing CLI flags
- `api/setImage.js` confirms the hosted app ingestion path is browser-centric, not command-centric

Design choice here:
- keep the agent package thin and terminal-friendly
- render deterministic SVG locally from a real screenshot path or image URL
- expose stable presets and explicit flags so any agent can call the renderer from a command tool

Future extension points:
- optional PNG export through a headless browser or Sharp-based rasterizer
- richer preset packs matching additional devices
- batch layouts for app-store style screenshot sets
