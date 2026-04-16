"use client";
import { useState, useEffect } from "react";
import { useSettings } from "@/lib/hooks/use-settings";

type OverlayMode = "direct" | "compose";

/** Overlay settings fetched from the server API. */
interface OverlaySettings {
  miniOverlayDefaultMode?: "direct" | "compose";
  voicePostProcessing?: boolean;
  voiceAudioCues?: boolean;
  miniOverlayAutoCloseAfterSpeak?: boolean;
  miniOverlayShowScreenPreview?: boolean;
  ttsReadCodeBlocks?: boolean;
}

function readStoredMode(): OverlayMode {
  if (typeof window === "undefined") return "direct";
  const stored = localStorage.getItem("overlay:mode");
  if (stored === "direct" || stored === "compose") return stored;
  return "direct";
}

/**
 * Manages overlay mode (direct/compose) with localStorage persistence.
 * Also fetches overlay-relevant settings from the server for downstream use.
 */
export function useOverlayMode() {
  const [mode, setModeState] = useState<OverlayMode>(readStoredMode);
  const [settings, setSettings] = useState<OverlaySettings>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Use shared settings cache instead of independent fetch
  const { settings: _cachedSettings, isLoading: settingsLoading } = useSettings();
  useEffect(() => {
    if (_cachedSettings) {
      const data = _cachedSettings;
      const fetched: OverlaySettings = {
        miniOverlayDefaultMode: data.miniOverlayDefaultMode as OverlaySettings["miniOverlayDefaultMode"],
        voicePostProcessing: data.voicePostProcessing as boolean | undefined,
        voiceAudioCues: data.voiceAudioCues as boolean | undefined,
        miniOverlayAutoCloseAfterSpeak: data.miniOverlayAutoCloseAfterSpeak as boolean | undefined,
        miniOverlayShowScreenPreview: data.miniOverlayShowScreenPreview as boolean | undefined,
        ttsReadCodeBlocks: data.ttsReadCodeBlocks as boolean | undefined,
      };
      setSettings(fetched);

      // If localStorage has no stored mode, apply the settings default
      if (typeof window !== "undefined" && !localStorage.getItem("overlay:mode")) {
        const defaultMode = fetched.miniOverlayDefaultMode ?? "direct";
        setModeState(defaultMode);
      }
    }
    // Mark loaded whether settings arrived or fetch completed (even on failure)
    if (!settingsLoading) {
      setSettingsLoaded(true);
    }
  }, [_cachedSettings, settingsLoading]);

  const setMode = (m: OverlayMode) => {
    setModeState(m);
    if (typeof window !== "undefined") {
      localStorage.setItem("overlay:mode", m);
    }
  };

  return {
    mode,
    setMode,
    /** Voice post-processing enabled (from settings, default true). */
    voicePostProcessing: settings.voicePostProcessing ?? true,
    /** Audio cues (start/stop tones) enabled (from settings, default true). */
    voiceAudioCues: settings.voiceAudioCues ?? true,
    /** Auto-close overlay after TTS finishes in direct mode. */
    autoCloseAfterSpeak: settings.miniOverlayAutoCloseAfterSpeak ?? false,
    /** Show screenshot thumbnail preview. */
    showScreenPreview: settings.miniOverlayShowScreenPreview ?? true,
    /** Whether code blocks should be read aloud in overlay TTS. */
    ttsReadCodeBlocks: settings.ttsReadCodeBlocks ?? false,
    /** Whether settings have been loaded from the server. */
    settingsLoaded,
  };
}
