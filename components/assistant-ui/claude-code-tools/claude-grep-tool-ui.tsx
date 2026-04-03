"use client";

import { type FC } from "react";
import { SearchIcon } from "lucide-react";
import { ClaudeToolCard, isToolErrorResult, ToolCardError, ToolCardPre } from "./claude-tool-card";
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

/**
 * Custom UI for Claude Code's `Grep` tool.
 * Shows search pattern, scope, and match results.
 */
export const ClaudeGrepToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const pattern = args?.pattern || "";
  const searchPath = args?.path;
  const fileGlob = args?.glob;
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|no such file|permission denied)/im);
  const content = parseTextResult(result);

  const resultLines = content ? content.split("\n").filter(l => l.trim()) : [];
  const matchCount = resultLines.length;

  const scopeParts: string[] = [];
  if (searchPath) scopeParts.push(searchPath.split("/").pop() || searchPath);
  if (fileGlob) scopeParts.push(fileGlob);
  if (args?.type) scopeParts.push(`*.${args.type}`);
  const scopeLabel = scopeParts.length > 0 ? scopeParts.join(" ") : undefined;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <SearchIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? "Searching..." : hasError ? "Search failed" : "Search"}
          </span>
          <span
            className="font-medium text-terminal-dark truncate min-w-0 flex-1"
            title={`${pattern}${scopeLabel ? ` in ${scopeLabel}` : ""}`}
          >
            {pattern}
            {scopeLabel && <span className="text-terminal-muted font-normal"> in {scopeLabel}</span>}
          </span>
          {!isRunning && !hasError && matchCount > 0 && (
            <span className="text-terminal-muted ml-auto shrink-0">
              {matchCount} match{matchCount !== 1 ? "es" : ""}
            </span>
          )}
        </>
      }
    >
      {searchPath && (
        <div className="text-terminal-muted truncate" title={searchPath}>
          {searchPath}
        </div>
      )}

      {resultLines.length > 0 && (
        <ToolCardPre className="max-h-64 overflow-y-auto">
          {resultLines.slice(0, 200).join("\n")}
          {resultLines.length > 200 && `\n\n... and ${resultLines.length - 200} more results`}
        </ToolCardPre>
      )}

      {!isRunning && !hasError && matchCount === 0 && (
        <div className="text-[11px] text-terminal-muted">No matches found</div>
      )}

      <ToolCardError content={hasError ? content : null} />

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Searching...</div>
      )}
    </ClaudeToolCard>
  );
};
