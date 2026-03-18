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
          "px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors",
          mode === "direct"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        Direct
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("compose")}
        className={[
          "px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors",
          mode === "compose"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        Compose
      </button>
    </div>
  );
}
