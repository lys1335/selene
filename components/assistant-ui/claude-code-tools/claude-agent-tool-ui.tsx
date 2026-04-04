"use client";

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircleIcon, XCircleIcon, BotIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolExpansion } from "../tool-expansion-context";
import { useTranslations } from "next-intl";
import { parseTextResult, parseTextResultWithStatus } from "./parse-text-result";
import { parseAgentSteps } from "../tool-live-status";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    description?: string;
    prompt?: string;
    subagent_type?: string;
    model?: string;
    isolation?: string;
    run_in_background?: boolean;
  };
  result?: unknown;
}>;

function isErrorResult(result: unknown): boolean {
  if (!result) return false;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.isError === true) return true;
  }
  const text = parseTextResult(result);
  if (text && /^(error|failed)/im.test(text.slice(0, 200))) return true;
  return false;
}

/**
 * Custom UI for Claude Code's `Agent` tool.
 * Shows agent type, description, and result summary.
 */
export const ClaudeAgentToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const t = useTranslations("assistantUi.claudeTools.agent");
  const [expanded, setExpanded] = useState(false);

  const expansionCtx = useToolExpansion();
  const lastSignalRef = useRef(0);
  useEffect(() => {
    if (!expansionCtx || expansionCtx.signal.counter === 0) return;
    if (expansionCtx.signal.counter === lastSignalRef.current) return;
    lastSignalRef.current = expansionCtx.signal.counter;
    setExpanded(expansionCtx.signal.mode === "expand");
  }, [expansionCtx?.signal]);

  const description = args?.description || "";
  const subagentType = args?.subagent_type;
  const model = args?.model;
  const isRunning = result === undefined;
  const hasError = isErrorResult(result);
  const { text: content, statuses: xmlStatuses } = parseTextResultWithStatus(result);

  // Live elapsed counter (approximate — starts from when this component mounts while running).
  const startTimeRef = useRef(Date.now());
  const [liveElapsedS, setLiveElapsedS] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    startTimeRef.current = Date.now();
    setLiveElapsedS(0);
    const id = setInterval(() => {
      setLiveElapsedS(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Parse steps from the agent result for the expanded view.
  const parsedSteps = useMemo(() => {
    if (!content || isRunning) return [];
    return parseAgentSteps(result).steps;
  }, [content, isRunning, result]);

  const StatusIcon = isRunning ? null : hasError ? XCircleIcon : CheckCircleIcon;
  const statusColor = isRunning
    ? "text-terminal-muted"
    : hasError
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";

  // Truncate result for display
  const DISPLAY_LIMIT = 10_000;
  const displayContent = content && content.length > DISPLAY_LIMIT
    ? content.substring(0, DISPLAY_LIMIT) + `\n\n... [${(content.length - DISPLAY_LIMIT).toLocaleString()} more characters]`
    : content;

  return (
    <div className="my-1 rounded-md border border-border bg-terminal-cream/50 dark:bg-terminal-cream/80 font-mono text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors text-left"
      >
        {StatusIcon && <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />}
        {!StatusIcon && <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-terminal-muted animate-pulse" />}
        <BotIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        <span className="text-terminal-muted">
          {isRunning ? t("running") : hasError ? t("failed") : t("done")}
        </span>
        <span className="font-medium text-terminal-dark truncate min-w-0 flex-1" title={description}>{description}</span>

        {subagentType && (
          <span className="text-[10px] text-terminal-muted shrink-0 bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] rounded px-1 py-0.5">
            {subagentType}
          </span>
        )}

        {model && (
          <span className="text-[10px] text-terminal-muted shrink-0">
            {model}
          </span>
        )}

        {isRunning && liveElapsedS > 0 && (
          <span className="text-[10px] text-terminal-muted/70 shrink-0 tabular-nums">
            {liveElapsedS}s
          </span>
        )}

        {expanded ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {args?.prompt && (
            <div className="space-y-1">
              <div className="text-[10px] text-terminal-muted uppercase tracking-wider">{t("prompt")}</div>
              <pre className="rounded bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] p-2 overflow-x-auto max-h-48 overflow-y-auto text-terminal-dark dark:text-terminal-dark/90 whitespace-pre-wrap break-all font-mono text-[11px]">
                {args.prompt.length > 2000
                  ? args.prompt.substring(0, 2000) + `\n\n... [${(args.prompt.length - 2000).toLocaleString()} more characters]`
                  : args.prompt}
              </pre>
            </div>
          )}

          {parsedSteps.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-terminal-muted uppercase tracking-wider">
                {t("steps")}
                <span className="ml-1.5 rounded-full bg-terminal-dark/10 px-1.5 py-0.5 text-[10px] leading-none text-terminal-muted tabular-nums">
                  {parsedSteps.length}
                </span>
              </div>
              <ol className="space-y-1">
                {parsedSteps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-[11px] text-terminal-dark dark:text-terminal-dark/90">
                    <span className="shrink-0 w-4 text-right text-terminal-muted tabular-nums">{i + 1}.</span>
                    <span className="[overflow-wrap:anywhere]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {displayContent && (
            <div className="space-y-1">
              <div className="text-[10px] text-terminal-muted uppercase tracking-wider">{t("result")}</div>
              <pre className="rounded bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] p-2 overflow-x-auto max-h-96 overflow-y-auto text-terminal-dark dark:text-terminal-dark/90 whitespace-pre-wrap break-all font-mono text-[11px]">
                {displayContent}
              </pre>
            </div>
          )}

          {hasError && content && (
            <div className="text-[11px] text-red-600 dark:text-red-400">{content.slice(0, 500)}</div>
          )}

          {isRunning && (
            <div className="text-terminal-muted animate-pulse">{t("working")}</div>
          )}
        </div>
      )}
    </div>
  );
};
