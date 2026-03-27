"use client";
import { useState, useEffect } from "react";

type OverlayMode = "direct" | "compose";

/** Overlay settings fetched from the server API. */
interface OverlaySettings {
  miniOverlayDefaultMode?: "direct" | "compose";
  voicePostProcessing?: boolean;
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

  // Fetch settings on mount — used for default mode fallback and overlay behavior flags
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const fetched: OverlaySettings = {
          miniOverlayDefaultMode: data.miniOverlayDefaultMode,
          voicePostProcessing: data.voicePostProcessing,
          miniOverlayAutoCloseAfterSpeak: data.miniOverlayAutoCloseAfterSpeak,
          miniOverlayShowScreenPreview: data.miniOverlayShowScreenPreview,
          ttsReadCodeBlocks: data.ttsReadCodeBlocks,
        };
        setSettings(fetched);
        setSettingsLoaded(true);

        // If localStorage has no stored mode, apply the settings default
        if (typeof window !== "undefined" && !localStorage.getItem("overlay:mode")) {
          const defaultMode = fetched.miniOverlayDefaultMode ?? "direct";
          setModeState(defaultMode);
        }
      } catch {
        // Settings fetch failed — use localStorage/hardcoded defaults
        setSettingsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
