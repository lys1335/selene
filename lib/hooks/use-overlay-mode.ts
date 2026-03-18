"use client";
import { useState } from "react";

export function useOverlayMode() {
  const [mode, setModeState] = useState<"direct" | "compose">(() => {
    if (typeof window === "undefined") return "direct";
    return (localStorage.getItem("overlay:mode") as "direct" | "compose") || "direct";
  });

  const setMode = (m: "direct" | "compose") => {
    setModeState(m);
    if (typeof window !== "undefined") {
      localStorage.setItem("overlay:mode", m);
    }
  };

  return { mode, setMode };
}
