# Selene

<div align="center">

![Version](https://img.shields.io/badge/version-0.2.6-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

<div align="center">
  <img src="assets/demo.gif" alt="Selene Demo" width="800"/>
</div>

<br/>

Selene is a desktop app that runs AI agents on your machine. Connect them to your WhatsApp, Telegram, Slack, or Discord. Write code, generate images, build personal assistants. All from one place. Your data stays on your device.

Every part of Selene (chat, embeddings, voice, images) lets you choose between local and cloud. Run everything offline or use APIs. Mix and match.

<div align="center">
<img src="public/icons/brands/selene.png" alt="Selene" height="40">
<br/>
<sub>Integrates with</sub>
<br/><br/>
<a href="#providers"><img src="public/icons/brands/anthropic.svg" alt="Anthropic" height="14"></a>&nbsp;&nbsp;
<a href="#providers"><img src="public/icons/brands/openai.svg" alt="OpenAI" height="14"></a>&nbsp;&nbsp;
<a href="#providers"><img src="public/icons/brands/ollama.svg" alt="Ollama" height="14"></a>&nbsp;&nbsp;
<a href="#providers"><img src="public/icons/brands/openrouter.svg" alt="OpenRouter" height="14"></a>&nbsp;&nbsp;
<a href="#providers"><img src="public/icons/brands/google.svg" alt="Google" height="14"></a>&nbsp;&nbsp;
<a href="#providers"><img src="public/icons/brands/minimax.svg" alt="Minimax" height="14"></a>&nbsp;&nbsp;
<a href="#providers"><img src="public/icons/brands/kimi.svg" alt="Kimi" height="14"></a>&nbsp;&nbsp;
<a href="#channels"><img src="public/icons/brands/slack.svg" alt="Slack" height="14"></a>&nbsp;&nbsp;
<a href="#channels"><img src="public/icons/brands/telegram.svg" alt="Telegram" height="14"></a>&nbsp;&nbsp;
<a href="#channels"><img src="public/icons/brands/discord.svg" alt="Discord" height="14"></a>&nbsp;&nbsp;
<a href="#channels"><img src="public/icons/brands/whatsapp.svg" alt="WhatsApp" height="14"></a>&nbsp;&nbsp;
<a href="#voice--avatar"><img src="public/icons/brands/elevenlabs.svg" alt="ElevenLabs" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/comfyui.svg" alt="ComfyUI" height="14"></a>&nbsp;&nbsp;
<a href="#modes"><img src="public/icons/brands/chromium.svg" alt="Chromium" height="14"></a>&nbsp;&nbsp;
<a href="#extend-it"><img src="public/icons/brands/mcp.svg" alt="MCP" height="14"></a>&nbsp;&nbsp;
<a href="#modes"><img src="public/icons/brands/puppeteer.svg" alt="Playwright" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/duckduckgo.svg" alt="DuckDuckGo" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/firecrawl.svg" alt="Firecrawl" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/lancedb.png" alt="LanceDB" height="14"></a>&nbsp;&nbsp;
<a href="#voice--avatar"><img src="public/icons/brands/microsoft.svg" alt="Microsoft" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/remotion.svg" alt="Remotion" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/tavily.svg" alt="Tavily" height="14"></a>&nbsp;&nbsp;
<a href="#creative-tools"><img src="public/icons/brands/onnx.svg" alt="ONNX Runtime" height="14"></a>&nbsp;&nbsp;
<a href="#for-developers"><img src="public/icons/brands/github.svg" alt="GitHub" height="14"></a>
</div>

<br/>

## Agent-First, Not Button-First

Every UI action is also an agent action — step in anywhere or let it run end-to-end. 99% of this codebase was written by Selene agents.

## Why We Built It

AI is expensive because models re-read everything, every turn. Selene runs a small retrieval model first — it finds what's relevant, the main agent picks it up and moves on. Tools load on demand. Context stays lean. You pay less per turn.

## Modes

### Selene Dev

- **Git, diffs, and PRs.** Stage, branch, diff, PR — from the UI or via agent.
- **Built-in browser.** Agent-controlled Chromium with console log access and session replay.
- **Output protection.** Bundled Rust tool trims long build/test output before it hits the model.
- **Automatic checks.** Hooks run type-checking, linting, or any custom logic after agent edits.

### Selene Fun

- **3D avatar.** Animated face with lip-sync and emotion detection.
- **Voice cloning.** Custom voice via ElevenLabs or Microsoft.
- **Scheduled assistants.** Cron tasks delivered to any connected channel.
- **Memory.** Selene surfaces things to remember; you approve what sticks.

### Selene Work *(coming soon)*

Team agents for company workflows.

## Channels

Connect your agent to your apps. Not through webhooks, as a native integration.

| Channel | Setup | What works |
|---------|-------|------------|
| **WhatsApp** | Scan a QR code | Messages, voice notes, attachments |
| **Telegram** | Paste a bot token | Messages, voice bubbles, interactive buttons |
| **Slack** | Socket Mode | Messages, files, native UI elements, threads |
| **Discord** | Paste a bot token | Messages, threads, buttons, attachments |

Voice notes are transcribed automatically. Pair with the scheduler for cron-based delivery.

## Features

| | |
|---|---|
| **Voice & Avatar** | STT (cloud/local, 32 languages), TTS with voice cloning, 3D avatar with lip-sync |
| **Images** | Local or cloud generation, reference images, ComfyUI workflows as agent tools |
| **Video** | Images → MP4 with transitions and overlays |
| **Deep Research** | Multi-pass web search with cited writeups |
| **Memory** | Surfaces suggestions after conversations; you approve what sticks |
| **Scheduler** | Cron, interval, or one-time tasks — delivered to any channel or kept in chat |
| **Skills** | Reusable agent instructions. 37+ built-in, create your own from the UI |
| **Plugins** | Bundle skills and tools together. Install from GitHub or a URL |
| **MCP** | Connect external services as agent tools |
| **Hooks** | Run custom logic before or after any agent action |
| **Themes** | 8 color themes, light/dark, 50 wallpapers (20 live), rich text prompt editor |

## Providers

Use any combination, or go fully local with no API keys.

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude with Agent SDK |
| **OpenAI** | GPT-5.4, Codex |
| **OpenRouter** | Claude, Gemini, Grok, DeepSeek, and more |
| **Ollama** | Any local model |
| **vLLM** | Self-hosted inference |
| **Kimi / Moonshot** | 256K context, vision |
| **Minimax** | 3 variants |
| **Antigravity** | Free tier via Google OAuth |


## Download

**macOS.** Signed DMG, drag to Applications.
**Windows.** Signed installer or portable build.

One download, no prerequisites. Selene bundles everything: runtime, local model support, browser engine, platform tools. The app is larger than usual because it ships what other tools make you install separately.

## For Developers

### Setup
```bash
npm install
npm run electron:dev
```

### Build
```bash
# Windows
npm run electron:dist:win

# macOS
npm run electron:dist:mac
```

### Runtime Secrets
Set in `.env`:
- `INTERNAL_API_SECRET`: internal API auth
- `REMOTION_MEDIA_TOKEN`: media URL token

### Troubleshooting
- **Native module errors**: `npm run electron:rebuild-native`
- **Embeddings mismatch**: reindex from Settings
- **MCP ENOENT**: reinstall from latest DMG/installer

## Docs
- `docs/ARCHITECTURE.md`: system layout
- `docs/AI_PIPELINES.md`: LLM and tool pipelines
- `docs/DEVELOPMENT.md`: dev setup and build
- `docs/API.md`: internal API reference

## Thanks
Built on open-source. See [THANKS.md](./THANKS.md).
