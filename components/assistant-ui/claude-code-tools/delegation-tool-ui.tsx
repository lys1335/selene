"use client";

import { type FC } from "react";
import { UsersIcon, Loader2Icon } from "lucide-react";
import { ClaudeToolCard, ToolCardPre } from "./claude-tool-card";
import { parseTextResult } from "./parse-text-result";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    action?: string;
    agentName?: string;
    agentId?: string;
    task?: string;
    context?: string;
    delegationId?: string;
    mode?: string;
    waitSeconds?: number;
    followUpMessage?: string;
    resume?: string;
    [key: string]: unknown;
  };
  result?: unknown;
}>;

interface DelegationResult {
  completed?: boolean;
  status?: string;
  delegationId?: string;
  delegateAgent?: string;
  lastResponse?: string;
  result?: string;
  allResponses?: string[];
  error?: string;
  isError?: boolean;
  content?: unknown;
  summary?: string;
  message?: string;
  [key: string]: unknown;
}

function extractDelegationResult(result: unknown): DelegationResult {
  if (!result) return {};
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as DelegationResult;
    } catch {
      return { result: result };
    }
  }
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    const text = parseTextResult(result);
    if (text && !r.completed && !r.delegationId && !r.lastResponse) {
      try {
        return JSON.parse(text) as DelegationResult;
      } catch {
        return { result: text };
      }
    }
    return r as DelegationResult;
  }
  return {};
}

function isDelegationError(dr: DelegationResult): boolean {
  if (dr.isError === true) return true;
  if (dr.error) return true;
  if (dr.status === "error") return true;
  return false;
}

/**
 * Dedicated UI for `delegateToSubagent` tool calls.
 * Shows agent name, delegation status, action, and result content.
 */
export const DelegationToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const action = args?.action || "start";
  const agentName = args?.agentName || "Sub-agent";
  const task = args?.task;
  const delegationIdFromArgs = args?.delegationId;
  const isRunning = result === undefined;

  const dr = extractDelegationResult(result);
  const hasError = isDelegationError(dr);
  const delegationId = dr.delegationId || delegationIdFromArgs;
  const resolvedAgentName = dr.delegateAgent || agentName;

  const mainContent =
    dr.lastResponse ||
    dr.result ||
    (dr.allResponses && dr.allResponses.length > 0
      ? dr.allResponses[dr.allResponses.length - 1]
      : undefined) ||
    parseTextResult(result) ||
    dr.message ||
    dr.summary ||
    "";

  const DISPLAY_LIMIT = 10_000;
  const displayContent =
    mainContent && mainContent.length > DISPLAY_LIMIT
      ? mainContent.substring(0, DISPLAY_LIMIT) +
        `\n\n... [${(mainContent.length - DISPLAY_LIMIT).toLocaleString()} more characters]`
      : mainContent;

  const statusLabel = isRunning
    ? `Delegating to ${resolvedAgentName}...`
    : hasError
      ? `${resolvedAgentName} failed`
      : `${resolvedAgentName}`;

  return (
    <ClaudeToolCard
      isRunning={isRunning}
      hasError={hasError}
      runningIndicator={
        <Loader2Icon className="h-3.5 w-3.5 shrink-0 text-terminal-muted animate-spin" />
      }
      headerContent={
        <>
          <UsersIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          <span className="text-terminal-muted">{statusLabel}</span>
          {action !== "start" && (
            <span className="text-[10px] text-terminal-muted shrink-0 bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] rounded px-1 py-0.5">
              {action}
            </span>
          )}
          {delegationId && (
            <span
              className="text-[10px] text-terminal-muted shrink-0 truncate max-w-[120px] ml-auto"
              title={delegationId}
            >
              {delegationId.slice(0, 8)}
            </span>
          )}
        </>
      }
    >
      {task && (
        <div className="space-y-1">
          <div className="text-[10px] text-terminal-muted uppercase tracking-wider">Task</div>
          <ToolCardPre className="max-h-48 overflow-y-auto">
            {task.length > 2000
              ? task.substring(0, 2000) + `\n\n... [${(task.length - 2000).toLocaleString()} more characters]`
              : task}
          </ToolCardPre>
        </div>
      )}

      {displayContent && !hasError && (
        <div className="space-y-1">
          <div className="text-[10px] text-terminal-muted uppercase tracking-wider">Result</div>
          <ToolCardPre className="max-h-96 overflow-y-auto">
            {displayContent}
          </ToolCardPre>
        </div>
      )}

      {dr.allResponses && dr.allResponses.length > 1 && mainContent && (
        <div className="space-y-1">
          <div className="text-[10px] text-terminal-muted uppercase tracking-wider">
            All Responses ({dr.allResponses.length})
          </div>
          <ToolCardPre className="max-h-48 overflow-y-auto">
            {(() => {
              const joined = dr.allResponses!
                .map((r, i) => `--- Response ${i + 1} ---\n${r}`)
                .join("\n\n");
              return joined.length > 5000
                ? joined.slice(0, 5000) + `\n\n... [${(joined.length - 5000).toLocaleString()} more characters]`
                : joined;
            })()}
          </ToolCardPre>
        </div>
      )}

      {hasError && (
        <div className="space-y-1">
          <div className="text-[10px] text-red-600 uppercase tracking-wider">Error</div>
          <pre className="rounded bg-red-50 dark:bg-red-950/40 p-2 overflow-x-auto max-h-48 overflow-y-auto text-red-700 dark:text-red-300 whitespace-pre-wrap break-all font-mono text-[11px]">
            {dr.error || dr.status || "Unknown error"}
          </pre>
        </div>
      )}

      {isRunning && (
        <div className="text-terminal-muted animate-pulse flex items-center gap-1.5">
          Sub-agent working...
        </div>
      )}
    </ClaudeToolCard>
  );
};
