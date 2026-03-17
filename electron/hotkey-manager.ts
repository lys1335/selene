import { globalShortcut } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { debugError, debugLog } from "./debug-logger";
import { DEFAULT_SCREEN_CAPTURE_HOTKEY } from "./screen-capture";

const DEFAULT_VOICE_HOTKEY = "CommandOrControl+Shift+Space";

const DEFAULT_UNIFIED_CAPTURE_HOTKEY = "CommandOrControl+Shift+A";

type HotkeyKind = "voice" | "screenCapture" | "unifiedCapture";

interface HotkeyRegistrationResult {
  success: boolean;
  accelerator: string;
  error?: string;
  disabled?: boolean;
}

const registeredHotkeys = new Map<HotkeyKind, string>();

function readSettings(dataDir: string): Record<string, unknown> {
  try {
    const settingsPath = path.join(dataDir, "settings.json");
    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    debugError("[Hotkeys] Failed to read settings:", error);
    return {};
  }
}

function readAcceleratorFromSettings(dataDir: string, key: string, defaultValue: string): string {
  const settings = readSettings(dataDir);
  const candidate = settings[key];
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return defaultValue;
}

function unregisterHotkey(kind: HotkeyKind, label: string): void {
  const accelerator = registeredHotkeys.get(kind);
  if (!accelerator) {
    return;
  }

  try {
    globalShortcut.unregister(accelerator);
  } catch (error) {
    debugError(`[${label}] Failed to unregister hotkey:`, error);
  }

  registeredHotkeys.delete(kind);
}

function registerHotkey(options: {
  kind: HotkeyKind;
  accelerator: string;
  fallbackAccelerator: string;
  label: string;
  enabled?: boolean;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  const enabled = options.enabled !== false;
  if (!enabled) {
    unregisterHotkey(options.kind, options.label);
    return {
      success: true,
      accelerator: "",
      disabled: true,
    };
  }

  const accelerator = options.accelerator.trim() || options.fallbackAccelerator;
  unregisterHotkey(options.kind, options.label);

  try {
    const ok = globalShortcut.register(accelerator, () => {
      try {
        options.onTrigger();
      } catch (error) {
        debugError(`[${options.label}] Trigger callback failed:`, error);
      }
    });

    if (!ok) {
      return {
        success: false,
        accelerator,
        error: `Failed to register global shortcut: ${accelerator}`,
      };
    }

    registeredHotkeys.set(options.kind, accelerator);
    debugLog(`[${options.label}] Registered: ${accelerator}`);
    return { success: true, accelerator };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugError(`[${options.label}] Registration error:`, error);
    return {
      success: false,
      accelerator,
      error: message,
    };
  }
}

export function registerVoiceHotkey(options: {
  accelerator: string;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  return registerHotkey({
    kind: "voice",
    accelerator: options.accelerator,
    fallbackAccelerator: DEFAULT_VOICE_HOTKEY,
    label: "VoiceHotkey",
    onTrigger: options.onTrigger,
  });
}

export function registerVoiceHotkeyFromSettings(options: {
  dataDir: string;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  const accelerator = readAcceleratorFromSettings(options.dataDir, "voiceHotkey", DEFAULT_VOICE_HOTKEY);
  return registerVoiceHotkey({ accelerator, onTrigger: options.onTrigger });
}

export function getRegisteredVoiceHotkey(): string {
  return registeredHotkeys.get("voice") || DEFAULT_VOICE_HOTKEY;
}

export function clearVoiceHotkey(): void {
  unregisterHotkey("voice", "VoiceHotkey");
}

export function registerScreenCaptureHotkey(options: {
  accelerator: string;
  enabled?: boolean;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  return registerHotkey({
    kind: "screenCapture",
    accelerator: options.accelerator,
    fallbackAccelerator: DEFAULT_SCREEN_CAPTURE_HOTKEY,
    label: "ScreenCapture",
    enabled: options.enabled,
    onTrigger: options.onTrigger,
  });
}

export function registerScreenCaptureHotkeyFromSettings(options: {
  dataDir: string;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  const settings = readSettings(options.dataDir);
  const enabled = settings.screenCaptureEnabled !== false;
  const accelerator =
    typeof settings.screenCaptureShortcut === "string" && settings.screenCaptureShortcut.trim().length > 0
      ? settings.screenCaptureShortcut.trim()
      : DEFAULT_SCREEN_CAPTURE_HOTKEY;

  return registerScreenCaptureHotkey({
    accelerator,
    enabled,
    onTrigger: options.onTrigger,
  });
}

export function getRegisteredScreenCaptureHotkey(): string {
  return registeredHotkeys.get("screenCapture") || DEFAULT_SCREEN_CAPTURE_HOTKEY;
}

export function clearScreenCaptureHotkey(): void {
  unregisterHotkey("screenCapture", "ScreenCapture");
}

// ---------------------------------------------------------------------------
// Unified Capture (voice + screen) hotkey
// ---------------------------------------------------------------------------

export function registerUnifiedCaptureHotkey(options: {
  accelerator: string;
  enabled?: boolean;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  return registerHotkey({
    kind: "unifiedCapture",
    accelerator: options.accelerator,
    fallbackAccelerator: DEFAULT_UNIFIED_CAPTURE_HOTKEY,
    label: "UnifiedCapture",
    enabled: options.enabled,
    onTrigger: options.onTrigger,
  });
}

export function registerUnifiedCaptureHotkeyFromSettings(options: {
  dataDir: string;
  onTrigger: () => void;
}): HotkeyRegistrationResult {
  const settings = readSettings(options.dataDir);
  const enabled = settings.quickCaptureEnabled !== false;
  const accelerator =
    typeof settings.quickCaptureHotkey === "string" && settings.quickCaptureHotkey.trim().length > 0
      ? settings.quickCaptureHotkey.trim()
      : DEFAULT_UNIFIED_CAPTURE_HOTKEY;

  return registerUnifiedCaptureHotkey({
    accelerator,
    enabled,
    onTrigger: options.onTrigger,
  });
}

export function getRegisteredUnifiedCaptureHotkey(): string {
  return registeredHotkeys.get("unifiedCapture") || DEFAULT_UNIFIED_CAPTURE_HOTKEY;
}

export function clearUnifiedCaptureHotkey(): void {
  unregisterHotkey("unifiedCapture", "UnifiedCapture");
}
