"use client";

import { useEffect, type FC } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToolExpansion } from "./tool-expansion-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const ExpandAllToolsButton: FC = () => {
  const ctx = useToolExpansion();
  const t = useTranslations("assistantUi.tools");

  // Keyboard shortcut: Cmd+Shift+E (Mac) / Ctrl+Shift+E (other) toggles all
  // tool details. Using a modifier-heavy chord avoids conflicts with normal
  // typing in textareas, contentEditable divs, and input fields.
  useEffect(() => {
    if (!ctx) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e" && !e.altKey) {
        e.preventDefault();
        ctx.toggleAll();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ctx]);

  if (!ctx) return null;

  // mode reflects the LAST action dispatched to consumers.
  // counter=0 means never toggled → default collapsed state.
  const isExpanded = ctx.signal.counter > 0 && ctx.signal.mode === "expand";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={ctx.toggleAll}
          className="h-6 gap-1 rounded-md px-2 text-[11px] font-mono text-terminal-muted hover:text-terminal-dark hover:bg-terminal-dark/5 transition-colors"
        >
          {isExpanded ? (
            <ChevronsDownUp className="size-3" />
          ) : (
            <ChevronsUpDown className="size-3" />
          )}
          {isExpanded ? t("collapseAll") : t("expandAll")}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs font-mono">
        {isExpanded ? t("collapseAll") : t("expandAll")}
        <kbd className="ml-1.5 rounded border border-current/20 px-1 py-0.5 text-[10px] opacity-60">
          ⌘⇧E
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
};
