"use client";

import { type FC } from "react";
import { BookOpenIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeToolCard, isToolErrorResult, toolStatusColor } from "./claude-tool-card";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    notebook_path?: string;
    new_source?: string;
    cell_id?: string;
    cell_type?: string;
    edit_mode?: string;
  };
  result?: unknown;
}>;

/**
 * Custom UI for Claude Code's `NotebookEdit` tool.
 * Shows notebook file name, cell edit info, and source preview.
 */
export const ClaudeNotebookEditToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const filePath = args?.notebook_path || "";
  const fileName = filePath.split("/").pop() || filePath;
  const editMode = args?.edit_mode || "replace";
  const cellType = args?.cell_type;
  const isRunning = result === undefined;
  const hasError = isToolErrorResult(result, /^(error|failed)/im);

  const actionLabel = editMode === "insert"
    ? "Insert cell"
    : editMode === "delete"
      ? "Delete cell"
      : "Edit cell";

  const statusColor = toolStatusColor(isRunning, hasError);
  const newSource = args?.new_source || "";
  const lineCount = newSource ? newSource.split("\n").length : 0;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <BookOpenIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">
            {isRunning ? `${actionLabel}...` : hasError ? `${actionLabel} failed` : actionLabel}
          </span>
          <span className="font-medium text-terminal-dark truncate min-w-0 flex-1" title={fileName}>
            {fileName}
          </span>
          {cellType && (
            <span className="text-[10px] text-terminal-muted shrink-0 bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] rounded px-1 py-0.5">
              {cellType}
            </span>
          )}
          {lineCount > 0 && editMode !== "delete" && (
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

      {newSource && (
        <pre className="rounded bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] p-2 overflow-x-auto max-h-64 overflow-y-auto text-terminal-dark dark:text-terminal-dark/90 whitespace-pre-wrap break-all font-mono text-[11px]">
          {newSource.length > 5000
            ? newSource.substring(0, 5000) + `\n\n... [${(newSource.length - 5000).toLocaleString()} more characters]`
            : newSource}
        </pre>
      )}

      {result !== undefined && (
        <div className={cn("text-[11px]", statusColor)}>
          {parseTextResult(result) || (hasError ? "Edit failed" : "Cell updated")}
        </div>
      )}

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Editing notebook...</div>
      )}
    </ClaudeToolCard>
  );
};
