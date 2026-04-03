"use client";

import { type FC, useState } from "react";
import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeToolCard, toolStatusColor } from "./claude-tool-card";
import { DiffStyledPre } from "../diff-styled-pre";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    file_path?: string;
    content?: string;
  };
  result?: unknown;
}>;

function isErrorResult(result: unknown): boolean {
  if (!result) return false;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.isError === true) return true;
    const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
    if (status === "error" || status === "failed" || status === "denied") return true;
  }
  const text = parseTextResult(result);
  if (text && /^(error|failed|permission denied)/im.test(text.slice(0, 200))) return true;
  return false;
}

/**
 * Custom UI for Claude Code's `Write` tool.
 * Shows file name, content preview, and line count.
 */
export const ClaudeWriteToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const [showFullContent, setShowFullContent] = useState(false);

  const filePath = args?.file_path || "";
  const fileName = filePath.split("/").pop() || filePath;
  const fileContent = args?.content || "";
  const lineCount = fileContent ? fileContent.split("\n").length : 0;
  const isRunning = result === undefined;
  const hasError = isErrorResult(result);

  const statusColor = toolStatusColor(isRunning, hasError);

  const maxContentLines = 100;
  const contentLines = fileContent.split("\n");
  const isContentTruncated = contentLines.length > maxContentLines;
  const visibleContent = !showFullContent && isContentTruncated
    ? contentLines.slice(0, maxContentLines).join("\n")
    : fileContent;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <PlusIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? "Writing..." : hasError ? "Write failed" : "Wrote"}
          </span>
          <span
            className="font-medium text-terminal-dark truncate min-w-0 flex-1"
            title={filePath || fileName}
          >
            {fileName}
          </span>
          {lineCount > 0 && (
            <span className="text-terminal-muted ml-auto shrink-0">
              <span className="text-emerald-600 dark:text-emerald-400">+{lineCount}</span>
            </span>
          )}
        </>
      }
    >
      <div className="text-terminal-muted truncate" title={filePath}>
        {filePath}
      </div>

      {fileContent && (
        <div className="space-y-2">
          <DiffStyledPre
            lines={visibleContent.split("\n").map(line => `+ ${line}`)}
            className="max-h-96 overflow-y-auto"
          />
          {isContentTruncated && (
            <button
              type="button"
              onClick={() => setShowFullContent(!showFullContent)}
              className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
            >
              {showFullContent ? "▲ Show less" : `▼ Show all (${contentLines.length} lines)`}
            </button>
          )}
        </div>
      )}

      {result !== undefined && (
        <div className={cn("text-[11px]", statusColor)}>
          {parseTextResult(result) || (hasError ? "Write failed" : "File written")}
        </div>
      )}

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Writing file...</div>
      )}
    </ClaudeToolCard>
  );
};
