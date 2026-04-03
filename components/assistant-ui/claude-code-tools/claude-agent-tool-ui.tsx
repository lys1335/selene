"use client";

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { BotIcon } from "lucide-react";
import { ClaudeToolCard, isToolErrorResult, ToolCardPre } from "./claude-tool-card";
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

/**
 * Custom UI for Claude Code's `Agent` tool.
 * Shows agent type, description, and result summary.
 */
export const ClaudeAgentToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const description = args?.description || "";
  const subagentType = args?.subagent_type;
  const model = args?.model;
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|failed)/im);
  const { text: content } = parseTextResultWithStatus(result);

  // Live elapsed counter
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

  const parsedSteps = useMemo(() => {
    if (!content || isRunning) return [];
    return parseAgentSteps(result).steps;
  }, [content, isRunning, result]);

  const DISPLAY_LIMIT = 10_000;
  const displayContent = content && content.length > DISPLAY_LIMIT
    ? content.substring(0, DISPLAY_LIMIT) + `\n\n... [${(content.length - DISPLAY_LIMIT).toLocaleString()} more characters]`
    : content;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <BotIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? "Running agent..." : hasError ? "Agent failed" : "Agent"}
          </span>
          <span
            className="font-medium text-terminal-dark truncate min-w-0 flex-1"
            title={description}
          >
            {description}
          </span>
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
        </>
      }
    >
      {args?.prompt && (
        <div className="space-y-1">
          <div className="text-[10px] text-terminal-muted uppercase tracking-wider">Prompt</div>
          <ToolCardPre className="max-h-48 overflow-y-auto">
            {args.prompt.length > 2000
              ? args.prompt.substring(0, 2000) + `\n\n... [${(args.prompt.length - 2000).toLocaleString()} more characters]`
              : args.prompt}
          </ToolCardPre>
        </div>
      )}

      {parsedSteps.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-terminal-muted uppercase tracking-wider">
            Steps
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
          <div className="text-[10px] text-terminal-muted uppercase tracking-wider">Result</div>
          <ToolCardPre className="max-h-96 overflow-y-auto">
            {displayContent}
          </ToolCardPre>
        </div>
      )}

      {hasError && content && (
        <div className="text-[11px] text-red-600 dark:text-red-400">{content.slice(0, 500)}</div>
      )}

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Agent working...</div>
      )}
    </ClaudeToolCard>
  );
};
