# Unified Voice + Screen Capture — Architecture Plan

> Branch: `feature/screen-capture-shortcut`
> Status: Phase 1 (screen-only shortcut) committed. This plan covers Phase 2: unified voice+screen capture.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Shortcut Strategy](#2-shortcut-strategy)
3. [UX Flows](#3-ux-flows)
4. [Electron Pipeline Architecture](#4-electron-pipeline-architecture)
5. [Composer UI Design](#5-composer-ui-design)
6. [STT + Vision Integration](#6-stt--vision-integration)
7. [Settings & Configuration](#7-settings--configuration)
8. [Permissions & Privacy](#8-permissions--privacy)
9. [Per-Agent Configuration](#9-per-agent-configuration)
10. [Onboarding Flow](#10-onboarding-flow)
11. [File Map](#11-file-map)
12. [Implementation Phases](#12-implementation-phases)
13. [Edge Cases](#13-edge-cases)
14. [Cost Analysis](#14-cost-analysis)

---

## 1. Overview

Users want their Selene agents to instantly access screen context when asking questions during active sessions (coding challenges, browser research, etc.) — without manually switching apps or uploading screenshots.

**The unified flow:** Press ONE shortcut → screen is captured (while other app is visible) → Selene comes forward → voice recording starts → user speaks their question → STT transcribes → screenshot + transcribed text are sent together to the active agent.

### What exists today (Phase 1, committed)
- Screen capture via `desktopCapturer` in `electron/screen-capture.ts`
- Global shortcut registration in `electron/hotkey-manager.ts`
- IPC bridge through `electron/preload.ts`
- Auto-attach to composer via `lib/hooks/use-screen-capture.ts`
- Settings toggle + shortcut customization in Settings panel
- Composer button for manual capture

### What this plan adds (Phase 2)
- Unified voice + screen capture in a single shortcut
- Combined composer UI with screenshot preview + voice waveform
- Screen metadata collection (active window title, app name, URL)
- Auto-send after transcription (configurable)
- Provider-aware image optimization
- Privacy controls and app exclusion list
- Per-agent screen awareness toggle
- Onboarding flow for first-time setup

---

## 2. Shortcut Strategy

Three distinct shortcuts, not one overloaded shortcut. Users develop muscle memory around specific gestures.

| Shortcut | Action | Default | Mnemonic |
|----------|--------|---------|----------|
| `Cmd+Shift+Space` | Voice only | Existing, unchanged | "Space = speak" |
| `Cmd+Shift+S` | Screen capture only | Phase 1, implemented | "S = screenshot" |
| `Cmd+Shift+A` | **Unified: capture + voice + send** | New | "A = ask" |

**Why not a single shortcut:**
- Hold-to-modify chord (hold shortcut while speaking) is physically awkward
- Sequential chord with invisible timeout creates mode ambiguity
- Three distinct, memorable shortcuts are predictable and fast

**Platform defaults:**
- macOS: `Cmd+Shift+{Space,S,A}`
- Windows/Linux: `Ctrl+Shift+{Space,S,A}`

All three are configurable in Settings. The unified shortcut always uses **tap mode** (press to start, press again to stop) regardless of the voice activation mode setting, because push-to-talk is impractical with modifier chords.

---

## 3. UX Flows

### Flow 1: Ask About Screen (Unified) — `Cmd+Shift+A`

The primary new flow. User is in another app, presses one shortcut, result is screenshot + transcribed voice sent to active agent.

**Step-by-step:**

1. **Trigger (0ms):** User presses `Cmd+Shift+A` from any application
2. **Screen Capture (0–200ms):** Main process captures screen BEFORE bringing Selene forward — captures what user is actually looking at, not the Selene window
3. **Bring Forward + Start Recording (200–400ms):** Window shows/focuses, screenshot auto-attaches to composer, voice recording starts simultaneously
4. **User Speaks (400ms – user duration):** Composer shows unified recording overlay (screenshot preview + waveform)
5. **Stop Recording:** User presses shortcut again, clicks stop, or presses Escape
6. **Transcription (500ms–3s):** STT processes audio, "Transcribing..." indicator shows
7. **Review or Auto-Send:**
   - **Compose mode (default):** Text appears in composer, user can edit, then send
   - **Quick Ask mode (opt-in):** Auto-sends after configurable delay (default 3s) with undo toast

**State Machine:**

```
IDLE
  |-- Cmd+Shift+A --> CAPTURING

CAPTURING
  |-- capture success --> RECORDING (screenshot attached)
  |-- capture failure --> RECORDING (no screenshot, toast notification)

RECORDING
  |-- shortcut / stop button / Escape --> TRANSCRIBING
  |-- mic error --> COMPOSING (screenshot stays, user types manually)

TRANSCRIBING
  |-- success + autoSend=false --> REVIEWING
  |-- success + autoSend=true  --> SENDING --> IDLE
  |-- failure --> COMPOSING (screenshot in composer, empty text, error toast)

REVIEWING
  |-- countdown expires --> SENDING --> IDLE
  |-- user edits text --> COMPOSING (countdown cancelled)
  |-- user cancels --> IDLE

COMPOSING
  |-- user sends --> IDLE
  |-- user cancels --> IDLE
```

### Flow 2: Screen Capture Only — `Cmd+Shift+S` (Phase 1, exists)

Press shortcut → capture screen → Selene comes forward → screenshot attached → user types question → sends.

### Flow 3: Voice Only — `Cmd+Shift+Space` (existing, unchanged)

Existing voice recording flow. No screen capture. Fully implemented.

### Flow Interaction Rules

| Current State | New Trigger | Behavior |
|---------------|-------------|----------|
| Recording (voice-only) | `Cmd+Shift+A` | Stop current, start unified flow |
| Recording (unified) | `Cmd+Shift+Space` | Treated as "stop recording" |
| Recording (unified) | `Cmd+Shift+S` | Ignored, voice takes precedence |
| Transcribing | Any shortcut | Ignored with toast |
| Composing (text in draft) | `Cmd+Shift+S` | Append new screenshot to attachments |
| Composing | `Cmd+Shift+A` | New screenshot + voice start, preserve existing text |

---

## 4. Electron Pipeline Architecture

### Unified Event Design

A **single IPC event** (`unified-capture:triggered`) carries the complete state to the renderer. Two separate events would create race conditions and require timeout-based correlation.

### Sequence Diagram

```
Hotkey Press (Cmd+Shift+A)
    |
    v
[hotkey-manager.ts] globalShortcut fires
    |
    v
[ipc-unified-capture-handlers.ts]
    |
    |--- (1) captureScreen() -- BEFORE window comes forward
    |         - macOS: screencapture -x (or desktopCapturer)
    |         - saves PNG to mediaDir/captures/
    |         - collects metadata (window title, app name)
    |         - returns { filePath, localMediaUrl, metadata }
    |
    |--- (2) mainWindow.show() + mainWindow.focus()
    |
    |--- (3) webContents.send("unified-capture:triggered", {
    |           mode: "voice+screen",
    |           screenshot: { url, filePath },
    |           metadata: { activeWindowTitle, activeAppName, ... },
    |           startVoice: true,
    |           traceId: "abc123"
    |         })
    |
    v
[preload.ts] → IPC bridge → renderer
    |
    v
[use-unified-capture.ts] hook receives event
    |
    |--- (4a) fetch(screenshot.url) → blob → File
    |         threadRuntime.composer.addAttachment(file)
    |
    |--- (4b) handleVoiceInput() → starts recording
    |
    v
[User speaks, sees screenshot thumbnail + waveform]
    |
    v
[Recording stops → STT → text inserted]
    |
    v
[Composer has: screenshot attachment + transcribed text]
[User reviews and sends (or auto-send fires)]
```

### IPC Message Interfaces

```typescript
// Main → Renderer: unified trigger event
interface UnifiedCaptureTriggerPayload {
  mode: "voice+screen" | "voice-only" | "screen-only";
  screenshot?: {
    url: string;        // local-media:// or /api/media/... URL
    filePath: string;   // absolute filesystem path
  };
  metadata?: ScreenCaptureMetadata;
  startVoice: boolean;
  screenshotError?: string;  // non-fatal, voice still proceeds
  traceId: string;           // correlate logs across processes
}

// Metadata collected at capture time
interface ScreenCaptureMetadata {
  capturedAt: string;              // ISO 8601
  activeWindowTitle?: string;      // e.g., "Boot.dev - Python Challenge 15"
  activeAppName?: string;          // e.g., "Google Chrome"
  activeUrl?: string;              // browser URL if detectable
  displayIndex?: number;           // which monitor
  originalResolution?: { width: number; height: number };
  captureMode: "fullscreen" | "active-window" | "region" | "display";
}

// Renderer → Main: manual trigger from UI button
interface UnifiedCaptureRequest {
  mode: "voice+screen" | "voice-only" | "screen-only";
}
```

### Key Design Decision: Capture Before Focus

The screen capture MUST happen before `mainWindow.show()`. Otherwise the screenshot captures the Selene window itself. Voice recording starts AFTER the window is visible (so the user sees the recording UI). These are sequential by necessity.

### Error Handling Invariant

**Voice recording never depends on screenshot success.** The `startVoice` field is set based on mode, not screenshot result. If capture fails, voice still proceeds. If mic fails, screenshot still attaches.

---

## 5. Composer UI Design

### Component Hierarchy

```
Composer (thread-composer.tsx)
  ├── Attachments area          [existing - screenshot thumbnail lives here]
  ├── UnifiedCaptureOverlay     <<<NEW>>>
  │   ├── CaptureScreenshotPreview  [enlarged screenshot during active session]
  │   ├── VoiceWaveform             [existing component, reused]
  │   ├── CaptureTimer              [recording duration]
  │   └── CaptureStatusLabel        ["Recording...", "Transcribing...", "Review"]
  ├── VoiceWaveform             [existing - standalone, hidden during unified]
  ├── textarea / TiptapEditor   [existing]
  ├── AutoSendCountdown         <<<NEW>>>
  │   ├── progress bar
  │   ├── "Sending in Xs..." label
  │   └── Cancel button
  └── ComposerActionBar         [existing, extended]
```

### State Machine Type

```typescript
type CaptureSessionPhase =
  | "idle"          // No unified session active
  | "capturing"     // Taking screenshot (~200-500ms)
  | "recording"     // Mic active, screenshot attached, waveform visible
  | "transcribing"  // STT running, spinner replaces waveform
  | "reviewing"     // Text + screenshot ready, auto-send countdown
  | "sending";      // Brief state while message sends
```

### Layout Per Phase

#### CAPTURING (200–500ms)

```
+------------------------------------------------------------------+
|  +------------------------------------------------------------+  |
|  |  .--.  Capturing screen...                                  |  |
|  |  |##|  <skeleton pulse animation>                           |  |
|  |  '--'                                                       |  |
|  +------------------------------------------------------------+  |
|  [textarea placeholder]                                           |
|  [action bar - all buttons dimmed/disabled]                       |
+------------------------------------------------------------------+
```

#### RECORDING (main active state)

```
+------------------------------------------------------------------+
|  +--------------------------------------------------+   [X]      |
|  |        Screenshot Preview (max-h-48)             |  cancel    |
|  |        (rounded corners, subtle border)          |            |
|  +--------------------------------------------------+            |
|  +------------------------------------------------------------+  |
|  |  (●)  |||||||||||||||||||||||||||  0:03                     |  |
|  |  red   waveform bars              elapsed timer             |  |
|  +------------------------------------------------------------+  |
|  [textarea - disabled, "Speak your question..."]                  |
|  [  Cancel  ]                              [ Stop & Send ]        |
+------------------------------------------------------------------+
```

#### TRANSCRIBING

```
+------------------------------------------------------------------+
|  +--------------------------------------------------+            |
|  |        Screenshot Preview (same)                 |            |
|  +--------------------------------------------------+            |
|  +------------------------------------------------------------+  |
|  |  [spinner]  Transcribing...                                 |  |
|  +------------------------------------------------------------+  |
|  [textarea - disabled, "Transcribing your voice..."]              |
|  [  Cancel  ]                                                     |
+------------------------------------------------------------------+
```

#### REVIEWING (auto-send countdown active)

```
+------------------------------------------------------------------+
|  [Screenshot thumbnail - normal size, in attachment bar]          |
|  [textarea - ENABLED, contains transcribed text, editable]        |
|  +------------------------------------------------------------+  |
|  |       Sending in 3s...  [===------]  [ Cancel ] [ Send ]   |  |
|  +------------------------------------------------------------+  |
|  [normal action bar - all buttons restored]                       |
+------------------------------------------------------------------+
```

### Action Bar Behavior

| Phase | Visible Buttons |
|-------|----------------|
| `idle` | All normal (deep research, voice, attach, screen capture, send) |
| `capturing` | All disabled/dimmed |
| `recording` | **Cancel** (ghost) + **Stop & Send** (primary, red accent) |
| `transcribing` | **Cancel** only |
| `reviewing` | All normal + auto-send countdown bar |

### Auto-Send Recommendation

**Configurable delay, default 3 seconds, cancel-on-edit.**

- 3s gives enough time to glance at transcription, not so much it feels sluggish
- Editing text or clicking textarea cancels countdown permanently for that session
- Setting `0` disables auto-send entirely (user must press Enter/Send)

### Animations

All animations respect `prefers-reduced-motion`. Key transitions:

- **IDLE → CAPTURING:** Composer border pulses green glow (300ms), skeleton fades in
- **CAPTURING → RECORDING:** Screenshot scales in (250ms), waveform slides in from below
- **RECORDING → TRANSCRIBING:** Waveform bars freeze then shrink, spinner fades in
- **TRANSCRIBING → REVIEWING:** Screenshot shrinks to attachment chip, text fades into textarea, countdown bar grows
- **Cancel at any phase:** All unified UI fades out (200ms), attached content stays in composer

### Accessibility

- `UnifiedCaptureOverlay`: `role="region"` with `aria-label="Screen capture and voice recording session"`
- Phase transitions announce via `aria-live="assertive"`:
  - CAPTURING: "Capturing screen..."
  - RECORDING: "Recording voice. Press Enter or hotkey to stop."
  - TRANSCRIBING: "Transcribing your voice..."
  - REVIEWING: "Review your message. Sending in X seconds."
- All buttons have explicit `aria-label`
- Tab order: textarea → Cancel → Stop/Send
- Keyboard: Enter = stop recording, Escape = cancel session

---

## 6. STT + Vision Integration

### Message Construction Pipeline

```
Screen capture          Voice recording
     |                       |
     v                       v
Image Processing        STT Transcription
- Resize to model max  - Whisper/Deepgram
- JPEG compress        - Raw text
- Collect metadata          |
     |                      v
     |                 Voice Enhancement
     |                 - fix-grammar action
     |                      |
     +------- MERGE --------+
                |
                v
     buildVoiceScreenMessage()
                |
                v
     POST /api/chat
     - parts[]: [ImagePart, TextPart(metadata), TextPart(voice)]
     - experimental_attachments[]
     - metadata.custom.screenContext
     - metadata.custom.inputMode: "voice-screen"
                |
                v
     extractContent() in content-extractor.ts
     - Converts image to base64 ImagePart
     - Formats metadata as structured text block
                |
                v
     Model receives:
     [ImagePart: screenshot]
     [TextPart: screen context metadata]
     [TextPart: transcribed voice question]
```

### Content Part Ordering

```
1. [ImagePart: screenshot]         — Visual context first
2. [TextPart: screen metadata]     — "What you're looking at"
3. [TextPart: voice transcription] — "What you said about it"
```

This ordering matches natural processing: see the screen, note the context, hear the question.

### Metadata Text Block Format

```
[Screen Context]
Captured: 2026-03-17T14:23:05.123Z
Active window: "Boot.dev - Python Challenge 15 - Google Chrome"
Active app: Google Chrome
URL: https://boot.dev/courses/python/ch15
Capture mode: active-window
Resolution: 1920x1080 → 1568x882 (optimized)
```

Placed as a text part between image and voice text. Plain-text, not JSON — models parse labeled lines more reliably in multipart context.

### Image Optimization Per Model

```typescript
const MODEL_IMAGE_CONFIGS: Record<string, ImageOptimizationConfig> = {
  anthropic: { maxDimension: 1568, jpegQuality: 80, maxBase64Bytes: 4.5 * 1024 * 1024 },
  openai:    { maxDimension: 2048, jpegQuality: 85, maxBase64Bytes: 20 * 1024 * 1024 },
  google:    { maxDimension: 2048, jpegQuality: 80, maxBase64Bytes: 10 * 1024 * 1024 },
  default:   { maxDimension: 1536, jpegQuality: 75, maxBase64Bytes: 4.5 * 1024 * 1024 },
};
```

Pipeline: Raw PNG (2–8MB) → JPEG conversion → Resize to provider max → Quality adjustment if over size limit → Store optimized copy → ~100–400KB final.

### STT + Vision Cross-Enhancement

**v1: Skip.** The model already receives both screenshot and transcription, so it can resolve "this variable" references.

**v2 design sketch:** Fast OCR (tesseract, ~100ms) extracts visible identifiers from screenshot → inject into Whisper prompt as custom vocabulary → STT runs with domain-aware vocabulary. This avoids the latency of a full vision model call.

### Multi-Agent Delegation Strategy

**Reference-based handoff, not inline base64.**

When the orchestrator delegates to a sub-agent:
- Screenshot is stored at `/api/media/screenshots/{captureId}.jpg`
- Delegation `task` includes a `ScreenCaptureRef` with mediaUrl + metadata text
- Sub-agent can use `describeImage` or `readFile` tool to inspect the screenshot if needed
- Text metadata (window title, URL, app name) travels as plain text in the delegation context

This avoids bloating the sub-agent's context window with base64 data.

### Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| Model is vision-capable | Send: image + metadata + voice text |
| Model NOT vision-capable | Run `describeImage` tool for text description, send text-only |
| STT fails | Send screenshot + metadata only with note "[Voice unavailable]" |
| Screen capture fails | Send voice text only as normal message |
| Both fail | Don't send, surface error to user |

---

## 7. Settings & Configuration

### New Settings Section: "Quick Capture"

Separate from existing "Voice & Audio" (which handles STT/TTS engine config). Quick Capture handles the interaction model.

### Settings Schema

```typescript
// In AppSettings / FormState

// Quick Capture
quickCaptureEnabled: boolean;                     // default: true
quickCaptureHotkey: string;                       // default: "CommandOrControl+Shift+A"
quickCaptureActivationMode: "tap" | "push";       // default: "tap"
quickCaptureMode: "voice-only" | "screen-only" | "voice-and-screen";  // default: "voice-and-screen"
quickCaptureAutoSend: boolean;                    // default: false
quickCaptureAutoSendDelay: number;                // seconds, default: 3

// Screen Capture
screenCaptureEnabled: boolean;                    // default: false (opt-in)
screenCaptureMode: "fullscreen" | "active-window" | "region";  // default: "active-window"
screenCaptureQuality: "low" | "medium" | "high";  // default: "medium"
screenCaptureIncludeCursor: boolean;              // default: true

// Privacy
screenCaptureExcludedApps: string[];              // default: ["1Password", "Keychain Access"]
screenCaptureRedactPasswords: boolean;            // default: true
screenCaptureRetention: "session" | "24h" | "7d" | "forever";  // default: "session"
screenCaptureShowPreview: boolean;                // default: true
screenCaptureNotifyOnCapture: boolean;            // default: true
```

### Settings UI Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  QUICK CAPTURE                                              │
│  Speak and show your screen to the AI in one action.        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  PERMISSIONS                                   [card] │  │
│  │  Microphone        [●  Granted]                       │  │
│  │  Screen Recording  [○  Not granted]  [Grant Access →] │  │
│  │  Accessibility     [●  Granted]                       │  │
│  │  [Test All Permissions]                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SHORTCUTS                                     [card] │  │
│  │  Quick Capture (voice + screen)                       │  │
│  │  ┌──────────────────────────────────┐                 │  │
│  │  │  ⌘ + Shift + A     [Record New] │                 │  │
│  │  └──────────────────────────────────┘                 │  │
│  │  Activation: (●) Tap  ( ) Hold to talk               │  │
│  │                                                       │  │
│  │  Screen-only shortcut (optional)                      │  │
│  │  ┌──────────────────────────────────┐                 │  │
│  │  │  ⌘ + Shift + S     [Record New] │                 │  │
│  │  └──────────────────────────────────┘                 │  │
│  │  ⚠ Voice-only keeps its shortcut from Voice settings  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  CAPTURE MODE                                  [card] │  │
│  │  What happens when you press the shortcut:            │  │
│  │  (●) Voice + Screen                                   │  │
│  │  ( ) Voice only                                       │  │
│  │  ( ) Screen only                                      │  │
│  │  ─────────────────────────────                        │  │
│  │  Screen target:                                       │  │
│  │  (●) Active window  ( ) Full screen  ( ) Region       │  │
│  │  [✓] Show preview before sending                      │  │
│  │  [ ] Auto-send after transcription (3s delay)         │  │
│  │  [✓] Notify on capture                                │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  PRIVACY & STORAGE                             [card] │  │
│  │  [✓] Redact detected password fields                  │  │
│  │  [✓] Include cursor in captures                       │  │
│  │  Excluded apps:                                       │  │
│  │  ┌────────────────────────────────────┐               │  │
│  │  │ 1Password [×]  Keychain Access [×] │               │  │
│  │  │ [+ Add app...]                     │               │  │
│  │  └────────────────────────────────────┘               │  │
│  │  Retention: (●) Session  ( ) 24h  ( ) 7d  ( ) Forever │  │
│  │  Quality: ( ) Low  (●) Medium  ( ) High               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Shortcut Conflict Resolution

Before registering a shortcut:
1. Check against known system shortcuts (Cmd+Space, Cmd+Tab, Cmd+Shift+3/4/5, etc.)
2. Check against other registered Selene shortcuts
3. Attempt Electron `globalShortcut.register()` — returns false if OS rejects

Settings UI includes a `[Record New]` button that listens for keystrokes and validates the combination.

### Settings Migration

On first load after upgrade:
1. If `quickCaptureHotkey` undefined, copy `voiceHotkey` value
2. Set `quickCaptureMode` to `"voice-only"` (preserve existing behavior)
3. Set `screenCaptureEnabled` to `false`
4. `voiceHotkey` field remains for backward compat

---

## 8. Permissions & Privacy

### macOS Permission Flow

```
Screen Capture enabled in settings
  → Check systemPreferences.getMediaAccessStatus('screen')
  → If not granted:
      Show in-settings banner with [Open System Settings] button
      → Opens x-apple.systempreferences:...Privacy_ScreenCapture
      → Poll every 2s until granted (up to 30s)
      → On grant: update status indicator, stop polling

Microphone:
  → systemPreferences.askForMediaAccess('microphone')
  → Native macOS prompt (one-time)

Accessibility (for global shortcuts):
  → systemPreferences.isTrustedAccessibilityClient(true)
  → Opens System Settings if not trusted
```

### Windows Permission Flow

- Screen recording: No permission required, `desktopCapturer` works without prompts
- Microphone: Standard Windows consent dialog on first `getUserMedia`
- Accessibility: Not required for `globalShortcut`

### Privacy Controls

| Control | Default | Description |
|---------|---------|-------------|
| App exclusion list | `["1Password", "Keychain Access"]` | Never capture when these apps are focused |
| Password redaction | `true` | Blur detected password fields (best-effort) |
| Capture retention | `"session"` | Auto-delete captures when session ends |
| Preview before send | `true` | Show screenshot in composer before sending |
| Notify on capture | `true` | Brief notification confirming capture |

**Data flow notice** (shown in Privacy settings card):
> "Screen captures are sent to your configured AI provider for analysis. They are processed according to that provider's data policies."

### Storage

- Location: `${dataPath}/captures/` — Electron userData, never cloud-synced
- Naming: `capture-{timestamp}-{mode}.jpg`
- Retention cleanup: background job per retention setting
- "Clear All Captures" button available in Privacy settings

---

## 9. Per-Agent Configuration

Screen capture is a capability toggle in the existing tool catalog system.

### Implementation

Add to `CHARACTER_TOOL_CATALOG` in `lib/characters/tool-catalog.ts`:

```typescript
{ id: "screenCapture", category: "analysis", dependencies: ["screenCaptureEnabled"] }
```

**How it works:**
- Global `screenCaptureEnabled` is the gate — if disabled, tool is locked in all agents
- Per-agent toggle: each agent can enable/disable `screenCapture` in its capabilities panel
- Agent templates can include `"screenCapture"` in their `enabledTools` array
- At send time: if `screenCapture` not in agent's enabled tools, strip image and warn user

---

## 10. Onboarding Flow

Triggers when user first enables screen capture or switches `quickCaptureMode` to include "screen".

### Steps

```
Step 1: PERMISSION CHECK (macOS only)
  → Banner showing permission status for mic, screen, accessibility
  → [Open System Settings] for each not-granted permission
  → Auto-advances when detected

Step 2: SHORTCUT CONFIGURATION
  → Shows current unified shortcut
  → [Keep this] or [Change shortcut]
  → Note about separate screen-only shortcut option

Step 3: PRIVACY DEFAULTS
  → Checkboxes for preview, password redaction, session retention
  → Note: captures sent to AI provider
  → [Done — Enable Screen Capture]

Step 4: CONFIRMATION TOOLTIP
  → Toast near composer: "Quick Capture enabled. Press ⌘+Shift+A to speak and share your screen."
```

Tracked via `screenCaptureOnboardingSeen: boolean` in settings. Runs once; re-triggerable via "Re-run setup" link.

---

## 11. File Map

### New Files

| File | Purpose |
|------|---------|
| `electron/ipc-unified-capture-handlers.ts` | IPC handlers for unified flow + hotkey registration |
| `electron/metadata-collector.ts` | OS-level metadata: active window title, app name, URL |
| `electron/permission-manager.ts` | Centralized permission checking/requesting |
| `lib/hooks/use-unified-capture.ts` | Renderer hook for unified capture events |
| `lib/hooks/use-capture-session.ts` | State machine hook for capture+record+send flow |
| `lib/voice-screen/types.ts` | TypeScript interfaces for unified pipeline |
| `lib/voice-screen/image-optimization.ts` | Provider-aware screenshot optimization |
| `lib/voice-screen/message-builder.ts` | Constructs unified message from screenshot + voice |
| `components/assistant-ui/unified-capture-overlay.tsx` | Screenshot preview + waveform combined view |
| `components/assistant-ui/auto-send-countdown.tsx` | Countdown ring/bar with cancel |
| `components/settings/shortcut-recorder.tsx` | "Press keys to record" shortcut input |
| `components/quick-capture/onboarding-dialog.tsx` | 3-step onboarding flow modal |

### Modified Files

| File | Changes |
|------|---------|
| `electron/hotkey-manager.ts` | Generalize to named shortcut registry (`registerShortcut`, `clearShortcut`) |
| `electron/ipc-handlers.ts` | Register unified capture handlers |
| `electron/preload.ts` | Add `unifiedCapture` bridge + permission IPC channels |
| `electron/main.ts` | Register unified shortcut at startup |
| `electron/screen-capture.ts` | Add metadata collection, app exclusion check |
| `lib/electron/types.ts` | Add unified capture types to ElectronAPI |
| `app/settings/settings-types.ts` | Add Quick Capture fields to FormState, section type |
| `app/settings/settings-panel.tsx` | Add Quick Capture section rendering |
| `app/api/settings/route.ts` | Handle new settings fields in PUT |
| `lib/settings/settings-manager.ts` | Add defaults + parsing for new fields |
| `app/api/chat/content-extractor.ts` | Handle `metadata.custom.screenContext` + `inputMode` |
| `components/assistant-ui/thread-composer.tsx` | Integrate `useCaptureSession`, render unified overlay |
| `components/assistant-ui/composer-action-bar.tsx` | Unified mode button states |
| `components/assistant-ui/thread.tsx` | Pass unified capture settings to composer |
| `lib/characters/tool-catalog.ts` | Add `screenCapture` tool entry |

### Unchanged Files

- `electron/ipc-voice-hotkey-handlers.ts` — voice-only path untouched
- `lib/hooks/use-global-hotkey.ts` — voice hook untouched
- `components/voice/voice-waveform.tsx` — reused as-is
- All existing voice pipeline code — backward compatible

---

## 12. Implementation Phases

### Phase 1 ✅ (Committed)
Screen-only capture shortcut. `electron/screen-capture.ts`, hotkey registration, IPC bridge, auto-attach to composer, settings toggle.

### Phase 2a: Unified IPC Pipeline
- `electron/ipc-unified-capture-handlers.ts` — orchestrates capture → focus → event
- `electron/metadata-collector.ts` — active window title/app
- Extend `hotkey-manager.ts` to named shortcut registry
- Extend `preload.ts` with unified bridge
- `lib/hooks/use-unified-capture.ts` — renderer event handler
- **Deliverable:** Shortcut triggers capture + voice start in one action

### Phase 2b: Composer UI
- `lib/hooks/use-capture-session.ts` — state machine
- `components/assistant-ui/unified-capture-overlay.tsx` — combined view
- `components/assistant-ui/auto-send-countdown.tsx` — countdown UI
- Modify `thread-composer.tsx` and `composer-action-bar.tsx`
- **Deliverable:** Full recording + review + auto-send experience

### Phase 2c: Settings & Onboarding
- Quick Capture settings section
- `components/settings/shortcut-recorder.tsx`
- `components/quick-capture/onboarding-dialog.tsx`
- `electron/permission-manager.ts`
- **Deliverable:** Settings UI + permission management + first-run onboarding

### Phase 2d: AI Pipeline Integration
- `lib/voice-screen/image-optimization.ts` — per-model optimization
- `lib/voice-screen/message-builder.ts` — metadata enrichment
- Modify `content-extractor.ts` for screen context
- Per-agent `screenCapture` tool in tool catalog
- **Deliverable:** Optimized images + metadata reach the model correctly

### Phase 3 (Future)
- Interactive region selection (transparent overlay window)
- STT+OCR cross-enhancement (domain vocabulary from screenshots)
- Screenshot deduplication (perceptual hash)
- Capture history/gallery UI
- Tray/menu bar OS icon
- Channel-aware screenshot compression (Telegram, Slack)

---

## 13. Edge Cases

| Edge Case | Handling |
|-----------|---------|
| **macOS Screen Recording permission denied** | Capture returns empty; degrade to voice-only; show toast with System Settings link |
| **Mic access denied during unified flow** | Screenshot attaches; user dropped to compose mode; toast: "Mic denied, type your question" |
| **Multiple displays** | Capture display containing focused window (use cursor position) |
| **User cancels mid-recording** | Discard recording; remove screenshot from attachments; return to idle |
| **Very short recording (<500ms)** | Likely "no speech detected"; keep screenshot, let user type |
| **Selene minimized or on another Space** | `mainWindow.show()` + `focus()` brings to current Space; capture happens before this |
| **Rapid successive triggers** | Debounce at 500ms in main process |
| **Agent streaming a response** | Message queued via existing `queuedMessages` system |
| **Deep Research mode (attachments disabled)** | Show toast warning, don't attach |
| **Excluded app focused** | Skip capture silently, proceed voice-only, brief toast: "Capture skipped - [App] is excluded" |
| **Renderer not ready at startup** | IPC event silently dropped (standard Electron); acceptable for first ~100ms |

---

## 14. Cost Analysis

### Per-Message Cost

| Component | Tokens (approx) | Cost (Claude Sonnet) |
|-----------|-----------------|---------------------|
| Screenshot (1568×882 JPEG, ~300KB) | ~1,600 image tokens | ~$0.0048 |
| Screen metadata text block | ~100 tokens | ~$0.0003 |
| Voice transcription (avg 2 sentences) | ~50 tokens | ~$0.00015 |
| **Total per voice+screen message** | **~1,750 tokens** | **~$0.005** |

For comparison: text-only message ≈ 50–200 input tokens. Voice+screen adds ~10× input cost, dominated by the image.

### Optimization Strategies

1. Aggressive JPEG compression (quality 70–80 preserves readable text, cuts size 3–5×)
2. Provider-specific sizing (don't send 2048px to Anthropic which caps at 1568px)
3. Session-level screenshot caching (detect "same screen" via perceptual hash, reference previous capture)
4. Selective inclusion (not every voice message needs a screenshot — make it opt-in per message or auto-detect deictic references: "this", "that", "here")

### Storage

- ~100–400KB per screenshot
- 100 captures/day = 10–40MB/day
- Default: auto-delete on session end
- "Forever" retention: ~300MB–1.2GB per month
