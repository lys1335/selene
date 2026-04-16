# Selene v0.3.4

A feature release with major work on voice input, the new Design Workspace, Ghost OS integration, and a Chrome 146 / Node 24 platform jump. Includes a broad Dependabot cleanup and a deep dead-code sweep across the codebase that trims the app size and tightens the runtime.

## New

### Voice Input
- New voice pipeline that feels instant — your transcribed words appear in the composer the moment recording stops, and grammar polishing happens in the background with a subtle visual effect
- You can now start a new recording while a previous one is still being polished — recordings no longer block each other
- Each recording remembers where your cursor was when you started, so transcripts always land in the right place even when multiple are in flight
- New "Transcriber model" setting in Voice & Audio — pick a dedicated model for grammar polishing, or let it use your utility model
- Revamped "Fix grammatical errors" toggle with clearer UI and disabled-state styling so you can keep raw transcripts as-is when you prefer
- Better dark-mode contrast on the polish-in-progress effect — it's now visible without being distracting
- Polish requests now time out gracefully after 60 seconds instead of hanging forever on a slow model
- More robust audio upload — the transcription endpoint now sniffs audio blobs by magic bytes (WebM/OGG/FLAC/WAV/MP3/MP4), so recordings with mismatched MIME headers still go through

### Design Workspace
- Brand new Design Workspace for generating, previewing, and exporting UI components with AI — components render live in an isolated sandbox
- Generated components save to your gallery and persist across sessions
- Export designs to HTML, React, PNG, or MP4
- Edit-in-place: ask the agent to tweak a component and the patch applies cleanly without re-generating from scratch
- Multi-select elements in the preview + apply-patch tool for targeted refinements
- Light / Dark / System preview toggle on every design
- Responsive preview that scales to mobile / tablet / desktop viewports
- Chat image attachments now flow into the design generation pipeline — drop a screenshot and ask for "this but in our style"
- Gallery auto-refreshes when new components are saved — no chat-switch needed to see them
- Project-native architecture with framework detection and worktree isolation for multi-framework rendering

### Models & Providers
- Added Claude Opus 4.7 to both the Anthropic API and Claude Code provider catalogues (1M context, vision, thinking)
- Added `kimi-k2.6-code-preview`
- Kimi OAuth device-flow login — sign into Kimi without copy-pasting API keys
- Better Ollama support: dynamic thinking-capability detection via `/api/show`, ECONNREFUSED recovery, relaxed URL validation for cloud-hosted instances, and a UX overhaul for the model picker
- M4 Apple Silicon crash detection with model validation UI (Validate & Redownload, Open Model Folder)

### Ghost OS (Phase 1)
- New Ghost OS integration that lets agents see what's on your screen — wired into the MCP tool pipeline for tool discovery
- Vision sidecar pre-flight for screen-parsing tools — health-checks the sidecar and auto-boots before `ghost_parse_screen` / `ghost_annotate` calls
- New Ghost OS settings section in MCP settings (status, permissions, vision model download)

### Chat Workspace Styles
- New chooser to switch between **Classic Sidebar** and **Browser Tabs** layouts for your chat window

### Folder Sync (replaces Knowledge Base)
- The old Knowledge Base system is gone — folders you sync now feed agents directly
- Native `fs.watch` / FSEvents on macOS instead of polling — much faster file change detection
- Sync notifications when files are picked up (toast + indicator)
- Better progress feedback, percentage progress bar, and stable polling (no more flickering)
- Unicode NFC normalization fixes long-standing macOS APFS encoding mismatches with Turkish/accented filenames

### Delegation
- Sub-agent results auto-deliver to the parent — no more `observe()` polling loops
- Parallel delegations stay alive when siblings complete
- Stale pending delegation calls now expire (1-hour TTL) instead of hanging across server restarts
- Subagent read errors surface properly instead of silently dropping

## Fixes

### Voice
- Fixed local Whisper failing in dev because the bundled ffmpeg wasn't being resolved — now checks the `ffmpeg-static` package path before falling back to the system PATH
- Fixed Whisper dylib bundling on Intel Macs (Homebrew `/usr/local/` paths)
- Fixed mini overlay readability and waveform contrast in direct mode
- Whisper is now self-contained — bundles the ggml backend plugins and dylibs, codesigns binaries, sets `DYLD_LIBRARY_PATH`

### Claude Code Agent SDK
- Fixed Claude Code login failing on some Windows setups
- Fixed packaged Claude SDK to use the bundled Node fallback
- Fixed Claude SDK executable path resolution + bundled ffmpeg for packaged builds
- Added CLI fallback for the auth check
- Fixed `shell:true` on Windows spawn so login completes
- Fixed Claude Code not picking up Node and voice pipelines on Windows due to ffmpeg bundling

### Design Workspace
- Fixed generated components not appearing in the gallery until you switched chats and back — gallery now refreshes automatically via a refresh event
- Fixed design workspace session leak and event loss when switching sessions
- Fixed preview rendering, dark mode, duplicate entries, and export UX
- Fixed DB save for components so edits survive cache eviction
- Stripped preview HTML from tool output at the source to prevent context bloat
- Fixed broken images by converting filesystem paths to `/api/media/` URLs
- Cached component code server-side to eliminate slow edit tool calls
- Mounted the workspace bridge unconditionally so 'open' events are received
- Added `__ASSET_N__` placeholder tokens to prevent base64 image hallucination

### File Sync & Watching
- Fixed file-watcher being blocked by chat activity — now flushes periodically and shows logs in production
- Fixed duplicated toast notifications from multiple watcher instances
- Increased event TTL to 75s and boosted polling on recent events
- Quieted noisy empty-flush logs while keeping useful diagnostics
- Excluded PHP/Ruby/iOS vendor dirs from indexing and raised vector DB file size limits
- Added `.swift` to the default synced file extensions

### Network & Reliability
- Switched internal servers from `localhost` to `127.0.0.1` to prevent `ERR_NETWORK_CHANGED` errors when your network changes
- Eliminated redundant network requests and polling — context-status calls dropped from 6 to 1–2, resources from 4 to 1
- Bound internal servers to loopback only for security
- Simplified think-tag filtering for Ollama
- Fixed H2 proxy IPv6 binding
- Fixed empty assistant messages and crash with non-thinking Ollama models

### Windows
- Fixed first-account crash on Windows by lazy-loading the LanceDB native module
- Fixed Windows environment handling and build config
- Fixed `describeImage` Windows path handling
- Fixed `where` vs `which` in electron-prepare
- Fixed Windows `cmd.exe` quoting in the bash tool
- Externalized `sharp` in the Electron bundle to fix Windows embedding init

### UI
- Fixed auth state flash after login/signup that was blocking the onboarding route
- Fixed focus stealing during screen capture
- Fixed structured Bash errors rendering as a generic "An error occurred"
- Fixed ghost branch picker appearing after delegation — consecutive assistant segments now merge into a single message
- Fixed tiptap toolbar buttons stealing focus from the editor
- Improved code block rendering and DMG cleanup resilience
- Fixed Chromium workspace panel not activating during foreground streaming
- Added missing i18n keys for embedding model validation UI (EN + TR) and extracted hundreds of hardcoded strings into translations

### Delegation
- Fixed false "dangling" errors on parallel observe calls
- Fixed premature error-sealing of in-flight delegated tool calls
- Fixed model badge OAuth refresh
- Block in `prepareStep` to keep the stream alive while waiting for sub-agents

### Channels
- Improved MCP tool naming and visibility

### Bash & Tools
- Fixed bash tool passing shell scripts via stdin instead of `-c` to fix heredoc failures
- Prevent the model from hallucinating `action` / `processId` on regular commands
- Fixed Claude Code provider dropping parallel same-name tool calls
- Added native bash tool and unified `toolSearch`
- Made `localGrep` always-loaded instead of deferred

### Browser Workspace
- Fixed browser session pop-out i18n provider missing
- Fixed inspector proxy for dev-server previews

## Changes

### Platform Upgrade
- Electron 39.8.6 → **41.2.1** (Chrome 142 → 146, Node 22 → 24, native ABI 140 → 145)
- electron-builder 26.0.12 → 26.8.1

### Security
- Merged 14 Dependabot PRs across this release; all actionable advisories in our direct dependencies are closed, with only transitive-only findings remaining
- Bumped: `lodash`, `drizzle-orm`, `mathjs`, `next-intl`, `path-to-regexp`, `hono`, `@hono/node-server`, `vite`, `@anthropic-ai/sdk`, `@xmldom/xmldom`, `next`, `basic-ftp`
- Removed unused `axios` dependency

### Removed
- Knowledge Base system — replaced by folder sync + skills (−2553 lines)
- Z-Image Docker backend (`comfyui_backend/`, Z-Image locales, `zimage-generate-tool`)
- Legacy ComfyUI local installer + flux2-klein tools and UI
- Remaining ComfyUI barrel files

### Cleanup
- Major dead-code sweep: deleted 168+ unused files, pruned 830+ unused exports, removed 13 unused dependencies, broke 31 circular dependency cycles
- Deduplicated 77+ clone groups across sidebar utils, browser actions, terminal pages, channel config, UI components, settings types, provider utilities, route handlers, electron types, and media utils
- Slimmed Electron main bundle from 7.9MB → 1.1MB by dynamic-importing `@huggingface/hub`

## Platform

- macOS (Apple Silicon + Intel) / Windows
- M1, M2, M3, M4 use arm64. If you're on Intel Mac, use the x64 dmg.

- Package version: `0.3.4`
