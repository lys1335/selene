"use client";

import { type FC } from "react";
import { GlobeIcon } from "lucide-react";
import { ClaudeToolCard, isToolErrorResult, ToolCardError, ToolCardPre } from "./claude-tool-card";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    query?: string;
    allowed_domains?: string[];
    blocked_domains?: string[];
  };
  result?: unknown;
}>;

/**
 * Custom UI for Claude Code's `WebSearch` tool.
 * Shows query, result count, and search content.
 */
export const ClaudeWebSearchToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const query = args?.query || "";
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|failed)/im);
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
            {isRunning ? "Searching..." : hasError ? "Search failed" : "Searched"}
          </span>
          <span className="font-medium text-terminal-dark truncate min-w-0 flex-1" title={query}>
            {query}
          </span>
        </>
      }
    >
      {displayContent && (
        <ToolCardPre className="max-h-64 overflow-y-auto">
          {displayContent}
        </ToolCardPre>
      )}

      <ToolCardError content={hasError ? content : null} />

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Searching the web...</div>
      )}
    </ClaudeToolCard>
  );
};
