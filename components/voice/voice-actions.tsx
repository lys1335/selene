"use client";

import { useState, useCallback, useRef } from "react";
import { CheckIcon, BriefcaseIcon, ListIcon, LanguagesIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface VoiceAction {
  id: string;
  labelKey: string;
  icon: React.ElementType;
  descriptionKey: string;
}

interface VoiceActionsProps {
  text: string;
  sessionId?: string;
  onResult: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

const ACTIONS: VoiceAction[] = [
  { id: "fix-grammar", labelKey: "actions.fixGrammar", icon: CheckIcon, descriptionKey: "actions.fixGrammarDesc" },
  { id: "professional", labelKey: "actions.professional", icon: BriefcaseIcon, descriptionKey: "actions.professionalDesc" },
  { id: "summarize", labelKey: "actions.summarize", icon: ListIcon, descriptionKey: "actions.summarizeDesc" },
  { id: "translate", labelKey: "actions.translate", icon: LanguagesIcon, descriptionKey: "actions.translateDesc" },
];

export function VoiceActions({ text, sessionId, onResult, className, disabled = false }: VoiceActionsProps) {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const runningRef = useRef(false);
  const t = useTranslations("voice");

  const handleAction = useCallback(async (actionId: string) => {
    if (!text.trim() || runningAction || runningRef.current) return;

    runningRef.current = true;
    setRunningAction(actionId);
    try {
      const response = await fetch("/api/voice/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          action: actionId,
          sessionId,
        }),
      });

      const data = await response.json() as { success?: boolean; text?: string; error?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.error || t("actions.actionFailed"));
      }

      if (typeof data.text === "string") {
        onResult(data.text);
        toast.success(t("actionComplete"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("actions.actionFailed");
      toast.error(message);
    } finally {
      setRunningAction(null);
      runningRef.current = false;
    }
  }, [text, sessionId, onResult, runningAction, t]);

  if (!text.trim()) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        const isRunning = runningAction === action.id;

        return (
          <button
            key={action.id}
            onClick={() => void handleAction(action.id)}
            disabled={disabled || !!runningAction}
            aria-label={t(action.descriptionKey)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-mono transition-all min-h-[36px]",
              "border border-terminal-border/40 text-terminal-muted",
              "hover:bg-terminal-cream/60 hover:text-terminal-dark hover:border-terminal-border",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isRunning && "bg-terminal-cream/60 border-terminal-dark/20"
            )}
          >
            {isRunning ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <Icon className="size-3" />
            )}
            <span className="hidden sm:inline">{t(action.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
