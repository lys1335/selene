"use client";
import { useState } from "react";

type OverlayMode = "direct" | "compose";

function readStoredMode(): OverlayMode {
  if (typeof window === "undefined") return "direct";
  const stored = localStorage.getItem("overlay:mode");
  if (stored === "direct" || stored === "compose") return stored;
  return "direct";
}

export function useOverlayMode() {
  const [mode, setModeState] = useState<OverlayMode>(readStoredMode);

  const setMode = (m: OverlayMode) => {
    setModeState(m);
    if (typeof window !== "undefined") {
      localStorage.setItem("overlay:mode", m);
    }
  };

  return { mode, setMode };
}
