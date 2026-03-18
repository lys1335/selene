"use client";

interface ModeToggleProps {
  mode: "direct" | "compose";
  onChange: (mode: "direct" | "compose") => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div
      className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border/40"
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
          "flex flex-col items-center px-2.5 py-1 rounded-md font-medium transition-colors",
          mode === "direct"
            ? "bg-primary text-primary-foreground shadow-sm text-sm"
            : "text-muted-foreground hover:text-foreground text-xs",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        Direct
        {mode === "direct" && (
          <span className="text-[10px] font-normal opacity-70 leading-tight mt-0.5">
            Voice → AI → Speak
          </span>
        )}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("compose")}
        className={[
          "flex flex-col items-center px-2.5 py-1 rounded-md font-medium transition-colors",
          mode === "compose"
            ? "bg-primary text-primary-foreground shadow-sm text-sm"
            : "text-muted-foreground hover:text-foreground text-xs",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        Compose
        {mode === "compose" && (
          <span className="text-[10px] font-normal opacity-70 leading-tight mt-0.5">
            Voice → Chat window
          </span>
        )}
      </button>
    </div>
  );
}
