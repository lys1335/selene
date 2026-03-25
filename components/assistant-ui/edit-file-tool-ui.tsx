"use client";

import { FC, useEffect, useMemo, useRef, useState } from "react";
import { FileIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, PencilIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useToolExpansion } from "./tool-expansion-context";
import { DiffStyledPre } from "./diff-styled-pre";

interface DiagnosticResult {
  tool: string;
  errors: number;
  warnings: number;
  output: string;
}

interface EditFileResult {
  status: "success" | "error" | "warning";
  filePath: string;
  message: string;
  linesChanged?: number;
  created?: boolean;
  diagnostics?: DiagnosticResult;
  diff?: string;
}

interface WriteFileResult {
  status: "success" | "error" | "warning";
  filePath: string;
  message: string;
  bytesWritten?: number;
  lineCount?: number;
  created?: boolean;
  diagnostics?: DiagnosticResult;
  diff?: string;
}

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args: { filePath?: string; oldString?: string; newString?: string; content?: string };
  result?: EditFileResult | WriteFileResult;
}>;

/**
 * Unwrap MCP-wrapped tool results.
 * MCP tools return `{ content: [{ type: "text", text: JSON.stringify(actual) }] }`.
 * This extracts the actual result object so fields like `diff`, `status`, etc. are accessible.
 */
function unwrapResult(raw: unknown): (EditFileResult | WriteFileResult) | undefined {
  if (!raw) return undefined;
  if (typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  // Already unwrapped — has expected fields directly
  if (r.diff !== undefined || r.status === "success" || r.status === "error" || r.status === "warning") {
    return raw as EditFileResult;
  }
  // MCP content array wrapper: { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(r.content)) {
    const textItem = (r.content as Array<Record<string, unknown>>).find(
      (item) => item?.type === "text" && typeof item.text === "string"
    );
    if (textItem?.text && typeof textItem.text === "string") {
      try { return JSON.parse(textItem.text); } catch { /* fall through */ }
    }
  }
  // Normalized string content wrapper
  if (typeof r.content === "string") {
    try { return JSON.parse(r.content); } catch { /* fall through */ }
  }
  return raw as EditFileResult;
}

export const EditFileToolUI: ToolCallContentPartComponent = ({
  toolName,
  args,
  result: rawResult,
}) => {
  const result = useMemo(() => unwrapResult(rawResult), [rawResult]);
  const t = useTranslations("assistantUi.editFileTool");
  const [expanded, setExpanded] = useState(false);
  const [showFullDiff, setShowFullDiff] = useState(false);
  const [showFullDiagnostics, setShowFullDiagnostics] = useState(false);

  // React to global expand/collapse signal
  const expansionCtx = useToolExpansion();
  const lastSignalRef = useRef(0);
  useEffect(() => {
    if (!expansionCtx || expansionCtx.signal.counter === 0) return;
    if (expansionCtx.signal.counter === lastSignalRef.current) return;
    lastSignalRef.current = expansionCtx.signal.counter;
    setExpanded(expansionCtx.signal.mode === "expand");
  }, [expansionCtx?.signal]);
  const filePath = (args?.filePath as string) || "";
  const fileName = filePath.split("/").pop() || filePath;

  // Determine action label based on tool type and result status
  const isWrite = toolName === "writeFile";
  const isCreating = isWrite
    ? (result as WriteFileResult)?.created
    : (result as EditFileResult)?.created ?? !(args?.oldString as string);

  // Dynamic label based on result status
  const getActionLabel = () => {
    if (!result) {
      return isCreating ? t("creating") : isWrite ? t("writing") : t("editing");
    }

    switch (result.status) {
      case "error":
        return isCreating ? t("createFailed") : isWrite ? t("writeFailed") : t("editFailed");
      case "warning":
        return isCreating ? t("createdWithWarnings") : isWrite ? t("wroteWithWarnings") : t("editedWithWarnings");
      case "success":
      default:
        return isCreating ? t("created") : isWrite ? t("wrote") : t("edited");
    }
  };

  const actionLabel = getActionLabel();
  const ActionIcon = isCreating ? PlusIcon : PencilIcon;

  const resultDiff = result?.diff;
  const fallbackDiff =
    !isWrite && args?.oldString && args?.newString
      ? `- ${String(args.oldString)}\n+ ${String(args.newString)}`
      : null;
  const diffText = resultDiff || fallbackDiff;
  const diffLines = diffText ? diffText.split("\n") : [];
  const maxDiffLines = 150;
  const isDiffTruncated = diffLines.length > maxDiffLines;
  const visibleDiffLines =
    !showFullDiff && isDiffTruncated
      ? diffLines.slice(0, maxDiffLines)
      : diffLines;

  // Status icon
  const StatusIcon = !result
    ? FileIcon
    : result.status === "success"
      ? CheckCircleIcon
      : result.status === "warning"
        ? AlertTriangleIcon
        : XCircleIcon;

  const statusColor = !result
    ? "text-terminal-muted"
    : result.status === "success"
      ? "text-terminal-green"
      : result.status === "warning"
        ? "text-terminal-amber"
        : "text-destructive";

  return (
    <div className="my-1 rounded-md border border-border bg-terminal-cream/50 dark:bg-terminal-cream/80 font-mono text-xs overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors text-left"
      >
        <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />
        <ActionIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        <span className="text-terminal-muted">{actionLabel}</span>
        <span className="font-medium text-terminal-dark truncate">{fileName}</span>

        {result && "linesChanged" in result && result.linesChanged !== undefined && (
          <span className="text-terminal-muted ml-auto shrink-0">
            {t("lines", { count: result.linesChanged })}
          </span>
        )}
        {result && "lineCount" in result && result.lineCount !== undefined && (
          <span className="text-terminal-muted ml-auto shrink-0">
            {t("lines", { count: result.lineCount })}
          </span>
        )}

        {/* Error message in collapsed header (truncated) */}
        {result?.status === "error" && result.message && (
          <span 
            className="text-destructive text-[10px] truncate max-w-[150px] ml-1" 
            title={result.message}
          >
            {result.message}
          </span>
        )}

        {result?.diagnostics && (result.diagnostics.errors > 0 || result.diagnostics.warnings > 0) && (
          <span className={cn(
            "ml-1 shrink-0",
            result.diagnostics.errors > 0 ? "text-destructive" : "text-terminal-amber"
          )}>
            {result.diagnostics.errors > 0 && `${result.diagnostics.errors}E`}
            {result.diagnostics.errors > 0 && result.diagnostics.warnings > 0 && " "}
            {result.diagnostics.warnings > 0 && `${result.diagnostics.warnings}W`}
          </span>
        )}

        {expanded ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div className="text-terminal-muted truncate" title={filePath}>
            {filePath}
          </div>

          {/* Show backend-provided diff first, fallback to args-derived diff */}
          {diffText && (
            <div className="space-y-2">
              <DiffStyledPre lines={visibleDiffLines} />

              {isDiffTruncated && (
                <button
                  type="button"
                  onClick={() => setShowFullDiff(!showFullDiff)}
                  className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
                >
                  {showFullDiff ? `▲ ${t("showLess")}` : `▼ ${t("showAll", { count: diffLines.length })}`}
                </button>
              )}
            </div>
          )}

          {/* Result message */}
          {result && (
            <div className={cn("text-[11px]", statusColor)}>
              {result.message}
            </div>
          )}

          {/* Diagnostics */}
          {result?.diagnostics && result.diagnostics.output && (() => {
            const { errors, warnings, output, tool } = result.diagnostics;
            const totalIssues = errors + warnings;
            const outputLines = output.split('\n');
            const hasMultipleIssues = totalIssues > 1;
            
            // Parse output to separate errors and warnings (basic heuristic)
            const errorLines: string[] = [];
            const warningLines: string[] = [];
            const otherLines: string[] = [];
            
            outputLines.forEach(line => {
              if (line.includes('error') || line.includes('✖')) {
                errorLines.push(line);
              } else if (line.includes('warning') || line.includes('⚠')) {
                warningLines.push(line);
              } else {
                otherLines.push(line);
              }
            });
            
            // Reconstruct output with errors first, then warnings
            const sortedOutput = [
              ...errorLines,
              ...warningLines,
              ...otherLines
            ].join('\n');
            
            return (
              <div className="rounded bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-terminal-muted">
                    {t("diagnosticsLabel", { tool })}
                  </div>
                  {hasMultipleIssues && (
                    <div className="text-[11px] flex gap-2">
                      {errors > 0 && (
                        <span className="text-destructive font-medium">
                          {t("errors", { count: errors })}
                        </span>
                      )}
                      {warnings > 0 && (
                        <span className="text-terminal-amber font-medium">
                          {t("warnings", { count: warnings })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="relative">
                  <pre 
                    className={cn(
                      "text-[11px] text-terminal-dark dark:text-terminal-dark/90 whitespace-pre-wrap break-all overflow-y-auto",
                      showFullDiagnostics ? "max-h-none" : "max-h-[300px]"
                    )}
                  >
                    {sortedOutput}
                  </pre>
                  
                  {outputLines.length > 20 && (
                    <button
                      type="button"
                      onClick={() => setShowFullDiagnostics(!showFullDiagnostics)}
                      className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline mt-1"
                    >
                      {showFullDiagnostics ? `▲ ${t("showLess")}` : `▼ ${t("showAll", { count: outputLines.length })}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Loading state */}
          {!result && (
            <div className="text-terminal-muted animate-pulse">
              {t("processing")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
