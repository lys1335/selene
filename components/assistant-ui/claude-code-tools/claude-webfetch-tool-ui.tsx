"use client";

import { type FC } from "react";
import { GlobeIcon } from "lucide-react";
import { ClaudeToolCard, isToolErrorResult, ToolCardError, ToolCardPre } from "./claude-tool-card";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    url?: string;
    prompt?: string;
  };
  result?: unknown;
}>;

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/**
 * Custom UI for Claude Code's `WebFetch` tool.
 * Shows URL domain, fetch status, and content preview.
 */
export const ClaudeWebFetchToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const url = args?.url || "";
  const domain = getDomain(url);
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|failed|404|403|500)/im);
  const content = parseTextResult(result);

  const DISPLAY_LIMIT = 5_000;
  const displayContent = content && content.length > DISPLAY_LIMIT
    ? content.substring(0, DISPLAY_LIMIT) + `\n\n... [${(content.length - DISPLAY_LIMIT).toLocaleString()} more characters]`
    : content;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <GlobeIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? "Fetching..." : hasError ? "Fetch failed" : "Fetched"}
          </span>
          <span className="font-medium text-terminal-dark truncate min-w-0 flex-1" title={domain}>
            {domain}
          </span>
          {content && !hasError && (
            <span className="text-terminal-muted ml-auto shrink-0">
              {Math.round(content.length / 1024)}KB
            </span>
          )}
        </>
      }
    >
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline truncate block text-[11px]"
        >
          {url}
        </a>
      )}

      {args?.prompt && (
        <div className="text-[11px] text-terminal-muted">
          Prompt: {args.prompt.length > 200 ? args.prompt.substring(0, 200) + "..." : args.prompt}
        </div>
      )}

      {displayContent && (
        <ToolCardPre className="max-h-64 overflow-y-auto">
          {displayContent}
        </ToolCardPre>
      )}

      <ToolCardError content={hasError ? content : null} />

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Fetching URL...</div>
      )}
    </ClaudeToolCard>
  );
};
