# Selene v0.3.5

A focused follow-up to v0.3.4 that pushes the Design Workspace from a preview-only sandbox into a real iteration tool — persisted snapshots, snapshot diffing, reference-image overlays, prop-grid rendering, in-place port/import to your codebase, and pseudo-state capture. New flagship models (DeepSeek V4, GPT-5.5, Kimi K2.6) come online with full thinking-mode plumbing, and several under-the-hood fixes make multi-provider chats, mid-stream injection, and channel acknowledgements work the way you expect.

## New

### Design Workspace

- **Persisted snapshots** — pin any iteration of a component to durable storage and bring it back later. Save, pin, rename, list, and delete snapshots scoped per session
- **Snapshot diff** — compare two snapshots side-by-side as a unified diff to see exactly what changed between iterations
- **Reference-image overlay** — drop a target screenshot on top of the live preview as a CSS-only opacity-toggleable layer to match a design pixel-for-pixel
- **renderMany prop grids** — pass `[{props, label}]` arrays and the workspace auto-grids permutations of your component, no DSL gymnastics required
- **Port to codebase** — apply your generated component back into a real synced file with mandatory `expectedContentSha256` content-addressed safety, atomic writes, and structured error codes for stale-diff / write-failed / read-failed cases
- **Import from codebase** — pull existing components from your synced folders into the workspace with idempotent `sourcePath` dedup and concurrent-import race protection
- **Pseudo-state harness** — capture hover, focus-visible, active, and disabled states side-by-side via CDP `CSS.forcePseudoState` for a named selector
- **Virtual-module imports** — one workspace component can import another via `design:<componentId>`, with path-sensitive cycle detection, scope checks, and structured error codes
- **Light / Dark / System theme threading** — composer now forwards your live theme selection on every turn so post-action screenshots always capture the correct mode (no more stale compiler defaults)
- **Custom viewport + device-scale-factor** — capture at any width/height with configurable pixel ratio per shot
- **Asset aliases + globals.css injection** — your real `globals.css` is read via `resolveSyncedPath` and injected into the preview, so design tokens live where they belong
- **Session rehydration** — sessions remember the last active component and bring it back when you reopen the chat
- **Probe expansions** — `colorScheme`, `cursor`, `transition`, `textShadow`, `overflow`, flex layout, and grid template properties added to `PROBE_CSS_PROPERTIES` so layout probes return real values instead of empty maps
- **Workspace memory + size-safety** — full code/preview kept only for the active component plus an LRU of 3 recently-hydrated; older entries shrink to stubs. Tool payload caps at 40KB with `code` dropped above 8KB and `previewHtml` above 4KB; mutating actions return compact stubs the bridge hydrates on demand

### Models & Providers

- **DeepSeek V4 provider** — four models live: `deepseek-v4-pro` (thinking), `deepseek-v4-flash` (fast), plus legacy `deepseek-reasoner` / `deepseek-chat` aliases. All share a 1M-token context window with 384K max output. Thinking mode is auto-configured per model — reasoning is captured, persisted, and replayed transparently across multi-turn conversations
- **Kimi K2.6** is the new flagship for chat, research, and vision roles — 256K context with native video understanding. K2.5 retained
- **GPT-5.5 and GPT-5.5 Pro** added to the model catalog (1M context, vision + thinking) with all six reasoning-effort variants (none/low/medium/high/xhigh) routable through both Codex and BlackboxAI
- **Mixed-provider sessions just work** — switching back to DeepSeek after using Claude Code, Codex, or Kimi mid-session no longer rejects the conversation. Missing reasoning is filled with honest placeholders so multi-turn flows stay alive
- **Image routing on image-hostile providers** — DeepSeek's chat endpoint rejects inline images, so:
  - **Composer warning badge** appears the moment you attach an image on an image-hostile provider, pointing you to Settings → Models → Vision before you hit send
  - **Dropped images** are replaced with actionable placeholders that name `describeImage` and surface the original URL as a ready-to-paste tool call
  - **`describeImage` is auto-promoted** so the tool is immediately available — no wasted discovery turn — and is auto-authorized for the request even if your agent template omits it
  - **Settings UI** renders an amber notice explaining the routing when DeepSeek is selected for Vision

### Chat

- **Mid-stream message injection renders in real time** — messages injected during an active run (from channels, delegation completions, etc.) appear in the chat immediately via a dedicated wire frame, instead of only at stream close. Channel connectors (Telegram, WhatsApp, Slack, Discord) now send native acknowledgements (eyes reaction or read receipt) so you're not staring at silence
- **"Nevermind, do X instead" no longer falsely stops the agent** — messages starting with stop-words like "nevermind" but containing redirect markers (`instead`, `let's`, `rather`, `switch to`) are now classified as pivots, not halts. The agent drops the old task and picks up the new one. Smart-quote apostrophes (`let's`) handled
- **Tool output stubs survive server restarts** — the truncated content store is now SQLite-backed by default; `trunc_XXX` content IDs persist across sessions. Stubs carry richer retrieval guidance with explicit `logId` handles and step-0 `searchTools` discovery instructions
- **Bash/executeCommand companion enforcement** — if `bash` is loaded but `executeCommand` isn't, the companion is auto-promoted so the model can retrieve oversized shell output via `readLog` without looping. Mirrored in the Selene SDK MCP server for Claude Agent SDK sessions
- **Ephemeral MCP results stubbed at persistence time** — model still sees full results in the current turn, but only compact `{status, summary, mediaRefs}` summaries land in the DB. Prevents replay bloat from large payloads like Ghost OS screenshots (~500KB each)
- **Base64 from SDK tool results sanitized at the bridge** — SDK built-ins (Read, Write, NotebookEdit) that stream base64 image envelopes are now intercepted, persisted to `/api/media/*` URLs, and rewritten so raw blobs never land in model-facing context

### Context Window

- **Provider-reported usage floor for Kimi** — Kimi's server-side token counter now serves as a floor for Selene's heuristic estimator. The status bar reflects real pressure instead of underreporting when vision payloads or thinking tokens push usage beyond estimates

### Workspace Lifecycle

- **Automatic cleanup on character / session delete** — git worktrees and sync-folder rows no longer accumulate as orphan data. Centralized cleanup runs at every exit path: workspace-tool delete, session soft-delete, session hard-purge, and character deletion
- **Boot-time orphan sweep** catches workspace rows whose backing sessions or on-disk worktrees were already gone
- **Workspace metrics** — in-process counters track create/delete counts and cleanup failures, exposed at `/api/admin/workspace-metrics` (local-only)

### Characters & Workflows

- **Duplication preserves workflow membership** — duplicated characters keep their workflow seat and re-share synced folders so multi-agent workflows stay intact
- **`source` column on sync folders** (`user` | `workspace`) prevents ephemeral workspace-tool worktrees from leaking into the Vector DB UI, workflow fanout, or folder-change notifications. Filesystem-level worktree detection backfills only legitimate git worktrees, eliminating false positives from user folders whose names happen to contain "Workspace:"

### Vector DB / Folder Sync

- **Workspace worktrees stay invisible** in the Vector DB sync-status panel — they were appearing as "pending" folders, cluttering the UI
- New `excludeWorkspaceSource()`, `onlyUserSource()`, `onlyWorkspaceSource()` predicates so every sync entry point filters consistently

### Plugins

- **New `overnight-keep-alive` plugin** — a Stop-hook that blocks the agent from terminating before a configurable wall-clock deadline (default 06:00 local). When a Stop event fires inside the overnight window, the hook forces a re-roll so the agent keeps grinding through your task until morning. Configurable via `SELENE_OVERNIGHT_END_HOUR`, `SELENE_OVERNIGHT_START_HOUR`, `SELENE_OVERNIGHT_WRAP`, and `SELENE_OVERNIGHT_TASK_FILE`

### Filesystem

- **Symlink-safe path containment** — synced-folder writes now do an ancestor `realpath` walk to catch writes into non-existent descendants under a symlinked ancestor
- New `readSyncedFile` helper centralizes containment + size/type gating + single-stat mtime capture for content-addressed safety

## Fixes

### Voice

- Fixed the mini-overlay ignoring the **"Fix grammatical errors"** toggle — grammar correction was silently re-enabled regardless of the user setting. Setting is now read via refs at recording-stop, so the current value always wins even if changed mid-recording
- Fixed mini-overlay auto-start capturing optimistic defaults before server settings loaded — first recording now waits for `settingsLoaded`
- Fixed missing start/stop audio cues in the mini-overlay — now plays 880/440 Hz tones matching the main composer
- Raised TTS provider timeouts to **60 seconds** (Edge TTS, OpenAI, ElevenLabs, client-side streaming) so long passages don't time out mid-synthesis. Previously 10s for `node-edge-tts`

### Onboarding

- Fixed Dev-path users silently getting **3D avatar** and **always-speak TTS** turned on — both defaults are now `false` and only activate when the user explicitly opts in from the Fun config panel

### Design Workspace

- Fixed Sprint 1 capture pipeline where preview readiness never set `data-preview-ready` after a Puppeteer protocolTimeout fix exposed downstream bugs — script blocks are now temporarily swapped during sanitize so React string literals like `"<head>"` survive intact, and CSP `<meta>` injection ignores `<head>` occurrences inside script bodies
- Fixed structural html/head/body tags being stripped on the first-party trust path so `previewTheme="dark"` actually attaches `class="dark"` to `<html>`
- Fixed probes reading `"16px Times"` because Tailwind v3 `fontFamily.sans` references `--font-inter` and `--font-jetbrains-mono` via `var()` with no inner fallback — those vars are now defined at `:root` and a `--selene-styles-applied: 1` sentinel is polled before the probe pass
- Fixed all 7 Sprint 1 screenshots failing with `Runtime.callFunctionOn timed out` — Puppeteer 24's default 3-min `protocolTimeout` was lower than the 8-min `waitForPageReady` budget; now set to 10 minutes
- Fixed agent reports of "truncated probe data" that were actually empty maps — `PROBE_CSS_PROPERTIES` expanded from 20 to 30 keys including `colorScheme`, layout properties, and visual properties; envelope-preservation through stream-guard tiers pinned by regression test

### DeepSeek Reasoning Pipeline

- Fixed DeepSeek V4 rejecting follow-up turns with HTTP 400 — `reasoning_content` is now captured at the streaming-state layer, persisted as canonical `{type:"reasoning"}` parts, and replayed on outbound requests
- Fixed sessions interleaving DeepSeek with non-thinking providers (Claude Code, Codex, Kimi) breaking on switch-back — neutral placeholder reasoning is synthesized for foreign assistant turns rather than fabricating thought
- Fixed reasoning replay missing for older sessions whose messages used the content-array shape instead of `parts`
- Fixed split assistant messages (text + tool-call → tool-result → trailing text) not having reasoning on the trailing fragment — `ensureReasoningOnAllAssistantMessages` post-split pass guarantees coverage
- Fixed images being sent to DeepSeek and erroring with `"unknown variant image_url"` — V4 chat is text/tool-use only; images are now stripped with actionable `describeImage` placeholders. Corrected stale `DEEPSEEK_VISION_MODELS` table that incorrectly claimed V4 supports vision

### Chat

- Fixed mid-stream injections being silently dropped on stream-error paths — drain-before-remove unified across reservation-only and real-run branches
- Fixed injection persistence errors being swallowed with `console.warn` — now fail-closed; the stream aborts cleanly and the message is preserved in an undrained store
- Fixed model looping helplessly on stubbed shell output — disable message now embeds explicit `logId` values and tool-loading instructions

### Vector DB / Folder Sync

- Fixed workspace-tool worktree paths appearing as "pending" folders in the Vector DB sync-status panel
- Fixed sync-status API and background-sync polling workspace rows as if they were user-configured knowledge folders

## Changes

### Documentation

- README refreshed with the v0.3.4 What's New section, updated providers and features tables, and a Chromium Workspace mode entry alongside Design Workspace and Ghost OS

### Removed

- Barrel exports under `components/design` and `lib/design/workspace` — callers now import directly from source paths per repo convention

## Platform

- macOS (Apple Silicon — M1, M2, M3, M4)
- This release ships an arm64 DMG only. Intel Mac and Windows builds will follow in a subsequent patch.

- Package version: `0.3.5`
