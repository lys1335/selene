"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function buildShortcuts(mod: string, t: (key: string) => string) {
  return [
    { label: t("newTab"), keys: `${mod}+T` },
    { label: t("closeTab"), keys: `${mod}+W` },
    { label: t("reopenTab"), keys: `${mod}+⇧+T` },
    { label: t("nextTab"), keys: "Ctrl+Tab" },
    { label: t("prevTab"), keys: "Ctrl+⇧+Tab" },
    { label: t("tab19"), keys: `${mod}+1–9` },
    { divider: true } as const,
    { label: t("focusComposer"), keys: `/ or ${mod}+L` },
    { label: t("library"), keys: `${mod}+K` },
  ] satisfies ReadonlyArray<{ label: string; keys: string } | { divider: true }>;
}

export function BrowserShortcutGuide() {
  const t = useTranslations("chat.browserWorkspace.shortcuts");
  const [open, setOpen] = useState(false);
  const [mod, setMod] = useState("Ctrl"); // SSR-safe default

  useEffect(() => {
    if (/Mac|iPod|iPhone|iPad/.test(navigator.userAgent)) {
      setMod("⌘");
    }
  }, []);

  const shortcuts = buildShortcuts(mod, t);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-full text-muted-foreground/50 hover:text-muted-foreground"
          title={t("keyboardShortcuts")}
          aria-label={t("keyboardShortcuts")}
        >
          <Keyboard className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-52 rounded-lg border border-border bg-popover p-0 shadow-xl data-[state=closed]:animate-none data-[state=open]:animate-none"
      >
        <div className="border-b border-border/50 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t("heading")}
        </div>
        <div className="flex flex-col py-1">
          {shortcuts.map((item, i) =>
            "divider" in item ? (
              <div key={`divider-${i}`} className="my-1 border-t border-border/40" />
            ) : (
              <div
                key={item.label}
                className="flex items-center justify-between px-3 py-1"
              >
                <span className="text-xs text-popover-foreground/80">
                  {item.label}
                </span>
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {item.keys}
                </kbd>
              </div>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
