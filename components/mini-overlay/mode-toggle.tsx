"use client";

import { Zap, PenLine } from "lucide-react";

interface ModeToggleProps {
  mode: "direct" | "compose";
  onChange: (mode: "direct" | "compose") => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border/40"
        style={{
          // @ts-ignore
          WebkitAppRegion: "no-drag",
        }}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("direct")}
          className={[
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            mode === "direct"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <Zap className="h-3 w-3" />
          Direct
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("compose")}
          className={[
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            mode === "compose"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <PenLine className="h-3 w-3" />
          Compose
        </button>
      </div>
      <span className="text-[10px] text-muted-foreground/70 leading-tight">
        {mode === "direct" ? "Send now and speak back" : "Refine, then open in Selene"}
      </span>
    </div>
  );
}
