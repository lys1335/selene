"use client";

import { type FC } from "react";
import { FileTextIcon } from "lucide-react";
import { ClaudeToolCard, isToolErrorResult, ToolCardError, ToolCardPre } from "./claude-tool-card";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    file_path?: string;
    offset?: number;
    limit?: number;
    pages?: string;
  };
  result?: unknown;
}>;

/**
 * Custom UI for Claude Code's `Read` tool.
 * Shows file name, line range, and content preview.
 */
export const ClaudeReadToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const filePath = args?.file_path || "";
  const fileName = filePath.split("/").pop() || filePath;
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|no such file|permission denied)/im);
  const content = parseTextResult(result);

  const lineCount = content ? content.split("\n").length : undefined;

  let rangeLabel = "";
  if (args?.offset || args?.limit) {
    const start = args.offset ?? 1;
    const end = args.limit ? start + args.limit : undefined;
    rangeLabel = end ? `L${start}–${end}` : `from L${start}`;
  }
  if (args?.pages) {
    rangeLabel = `pages ${args.pages}`;
  }

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
          <FileTextIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? "Reading..." : hasError ? "Read failed" : "Read"}
          </span>
          <span
            className="font-medium text-terminal-dark truncate min-w-0 flex-1"
            title={filePath || fileName}
          >
            {fileName}
          </span>
          {rangeLabel && (
            <span className="text-terminal-muted shrink-0">{rangeLabel}</span>
          )}
          {lineCount && !hasError && (
            <span className="text-terminal-muted ml-auto shrink-0">
              {lineCount} lines
            </span>
          )}
        </>
      }
    >
      <div className="text-terminal-muted truncate" title={filePath}>
        {filePath}
      </div>

      {displayContent && (
        <ToolCardPre className="max-h-96 overflow-y-auto">
          {displayContent}
        </ToolCardPre>
      )}

      <ToolCardError content={hasError ? content : null} />

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Reading file...</div>
      )}
    </ClaudeToolCard>
  );
};
