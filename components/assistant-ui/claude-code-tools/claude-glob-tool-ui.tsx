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
  };
  result?: unknown;
}>;

/**
 * Custom UI for Claude Code's `Glob` tool.
 * Shows pattern, directory scope, and matched file list.
 */
export const ClaudeGlobToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const pattern = args?.pattern || "";
  const searchPath = args?.path;
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|no such file|permission denied)/im);
  const content = parseTextResult(result);

  const files = content ? content.split("\n").filter(l => l.trim()) : [];
  const fileCount = files.length;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <SearchIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? "Finding..." : hasError ? "Find failed" : "Find"}
          </span>
          <span className="font-medium text-terminal-dark truncate min-w-0 flex-1" title={pattern}>
            {pattern}
          </span>
          {!isRunning && !hasError && fileCount > 0 && (
            <span className="text-terminal-muted ml-auto shrink-0">
              {fileCount} file{fileCount !== 1 ? "s" : ""}
            </span>
          )}
        </>
      }
    >
      {searchPath && (
        <div className="text-terminal-muted truncate" title={searchPath}>
          in {searchPath}
        </div>
      )}

      {files.length > 0 && (
        <ToolCardPre className="max-h-64 overflow-y-auto">
          {files.slice(0, 200).join("\n")}
          {files.length > 200 && `\n\n... and ${files.length - 200} more files`}
        </ToolCardPre>
      )}

      <ToolCardError content={hasError ? content : null} />

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Searching files...</div>
      )}
    </ClaudeToolCard>
  );
};
