"use client";

import { type FC, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeToolCard, toolStatusColor } from "./claude-tool-card";
import { DiffStyledPre } from "../diff-styled-pre";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
  };
  result?: unknown;
}>;

function isErrorResult(result: unknown): boolean {
  if (!result) return false;
  const text = parseTextResult(result);
  if (text && /error|failed|denied/i.test(text.slice(0, 100))) return true;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.isError === true) return true;
    const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
    if (status === "error" || status === "failed" || status === "denied") return true;
  }
  return false;
}

/**
 * Custom UI for Claude Code's `Edit` tool.
 * Shows file name, diff preview (old_string → new_string), and result status.
 */
export const ClaudeEditToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const [showFullDiff, setShowFullDiff] = useState(false);

  const filePath = args?.file_path || "";
  const fileName = filePath.split("/").pop() || filePath;
  const isCreating = !args?.old_string && !!args?.new_string;
  const isRunning = result === undefined;
  const hasError = isErrorResult(result);

  const getActionLabel = () => {
    if (isRunning) return isCreating ? "Creating..." : "Editing...";
    if (hasError) return isCreating ? "Create failed" : "Edit failed";
    return isCreating ? "Created" : "Edited";
  };

  const ActionIcon = isCreating ? PlusIcon : PencilIcon;
  const statusColor = toolStatusColor(isRunning, hasError);

  const diffLines: string[] = [];
  if (args?.old_string) {
    for (const line of args.old_string.split("\n")) {
      diffLines.push(`- ${line}`);
    }
  }
  if (args?.new_string) {
    for (const line of args.new_string.split("\n")) {
      diffLines.push(`+ ${line}`);
    }
  }

  const maxDiffLines = 150;
  const isDiffTruncated = diffLines.length > maxDiffLines;
  const visibleDiffLines = !showFullDiff && isDiffTruncated
    ? diffLines.slice(0, maxDiffLines)
    : diffLines;

  const additions = diffLines.filter(l => l.startsWith("+ ")).length;
  const removals = diffLines.filter(l => l.startsWith("- ")).length;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      headerContent={
        <>
          <ActionIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">{getActionLabel()}</span>
          <span
            className="font-medium text-terminal-dark truncate min-w-0 flex-1"
            title={filePath || fileName}
          >
            {fileName}
          </span>
          {(additions > 0 || removals > 0) && (
            <span className="ml-auto shrink-0 text-terminal-muted">
              {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
              {additions > 0 && removals > 0 && " "}
              {removals > 0 && <span className="text-red-500 dark:text-red-400">-{removals}</span>}
            </span>
          )}
          {args?.replace_all && (
            <span className="text-terminal-muted text-[10px] ml-1">(all)</span>
          )}
        </>
      }
    >
      <div className="text-terminal-muted truncate" title={filePath}>
        {filePath}
      </div>

      {diffLines.length > 0 && (
        <div className="space-y-2">
          <DiffStyledPre lines={visibleDiffLines} />
          {isDiffTruncated && (
            <button
              type="button"
              onClick={() => setShowFullDiff(!showFullDiff)}
              className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
            >
              {showFullDiff ? "▲ Show less" : `▼ Show all (${diffLines.length} lines)`}
            </button>
          )}
        </div>
      )}

      {result !== undefined && (
        <div className={cn("text-[11px]", statusColor)}>
          {parseTextResult(result) || (hasError ? "Edit failed" : "Edit applied")}
        </div>
      )}

      {isRunning && (
        <div className="text-terminal-muted animate-pulse">Processing...</div>
      )}
    </ClaudeToolCard>
  );
};
