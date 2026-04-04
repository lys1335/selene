"use client";

import { type FC, useEffect, useRef, useState } from "react";
import { CheckCircleIcon, XCircleIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolExpansion } from "../tool-expansion-context";
import { useTranslations } from "next-intl";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    pattern?: string;
    path?: string;
    glob?: string;
    type?: string;
    output_mode?: string;
    "-i"?: boolean;
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
  if (text && /^(error|no such file|permission denied)/im.test(text.slice(0, 200))) return true;
  return false;
}

/**
 * Custom UI for Claude Code's `Grep` tool.
 * Shows search pattern, scope, and match results.
 */
export const ClaudeGrepToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const t = useTranslations("assistantUi.claudeTools.grep");
  const [expanded, setExpanded] = useState(false);

  const expansionCtx = useToolExpansion();
  const lastSignalRef = useRef(0);
  useEffect(() => {
    if (!expansionCtx || expansionCtx.signal.counter === 0) return;
    if (expansionCtx.signal.counter === lastSignalRef.current) return;
    lastSignalRef.current = expansionCtx.signal.counter;
    setExpanded(expansionCtx.signal.mode === "expand");
  }, [expansionCtx?.signal]);

  const pattern = args?.pattern || "";
  const searchPath = args?.path;
  const fileGlob = args?.glob;
  const isRunning = result === undefined;
  const hasError = isErrorResult(result);
  const content = parseTextResult(result);

  // Count matches from result lines
  const resultLines = content ? content.split("\n").filter(l => l.trim()) : [];
  const matchCount = resultLines.length;

  // Build scope label
  const scopeParts: string[] = [];
  if (searchPath) scopeParts.push(searchPath.split("/").pop() || searchPath);
  if (fileGlob) scopeParts.push(fileGlob);
  if (args?.type) scopeParts.push(`*.${args.type}`);
  const scopeLabel = scopeParts.length > 0 ? scopeParts.join(" ") : undefined;

  const StatusIcon = isRunning ? null : hasError ? XCircleIcon : CheckCircleIcon;
  const statusColor = isRunning
    ? "text-terminal-muted"
    : hasError
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <div className="my-1 rounded-md border border-border bg-terminal-cream/50 dark:bg-terminal-cream/80 font-mono text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors text-left"
      >
        {StatusIcon && <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />}
        {!StatusIcon && <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-terminal-muted animate-pulse" />}
        <SearchIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        <span className="text-terminal-muted">{isRunning ? t("running") : hasError ? t("failed") : t("done")}</span>
        <span className="font-medium text-terminal-dark truncate min-w-0 flex-1" title={`${pattern}${scopeLabel ? ` in ${scopeLabel}` : ""}`}>
          {pattern}
          {scopeLabel && <span className="text-terminal-muted font-normal"> in {scopeLabel}</span>}
        </span>

        {!isRunning && !hasError && matchCount > 0 && (
          <span className="text-terminal-muted ml-auto shrink-0">
            {matchCount} match{matchCount !== 1 ? "es" : ""}
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
          {searchPath && (
            <div className="text-terminal-muted truncate" title={searchPath}>
              {searchPath}
            </div>
          )}

          {resultLines.length > 0 && (
            <pre className="rounded bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] p-2 overflow-x-auto max-h-64 overflow-y-auto text-terminal-dark dark:text-terminal-dark/90 whitespace-pre-wrap break-all font-mono text-[11px]">
              {resultLines.slice(0, 200).join("\n")}
              {resultLines.length > 200 && `\n\n${t("andMoreResults", { count: resultLines.length - 200 })}`}
            </pre>
          )}

          {!isRunning && !hasError && matchCount === 0 && (
            <div className="text-[11px] text-terminal-muted">{t("noMatches")}</div>
          )}

          {hasError && content && (
            <div className="text-[11px] text-red-600 dark:text-red-400">{content.slice(0, 500)}</div>
          )}

          {isRunning && (
            <div className="text-terminal-muted animate-pulse">{t("searching")}</div>
          )}
        </div>
      )}
    </div>
  );
};
