"use client";

import { type FC, useEffect, useRef, useState } from "react";
import { CommandOutput } from "@/components/ui/command-output";
import type { InlineDiffPayload } from "@/lib/command-execution/types";
import { useToolExpansion } from "../tool-expansion-context";
import { parseTextResult } from "./parse-text-result";

type BashArgs = {
  command?: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
  processId?: string;
  action?: "status" | "kill" | "list";
};

type BashResult = {
  status?: string;
  stdout?: string;
  stderr?: string;
  inlineDiff?: string | InlineDiffPayload;
  error?: string;
  message?: string;
  exitCode?: number | null;
  executionTime?: number;
  logId?: string;
  isTruncated?: boolean;
};

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: BashArgs;
  result?: unknown;
}>;

function getCommandLabel(args?: BashArgs): string {
  if (!args) return "(unknown command)";
  if (args.command) {
    return args.command.trim().startsWith("apply_patch <<") ? "apply_patch" : args.command;
  }
  if (args.action === "list") return "list background processes";
  if (args.processId) {
    if (args.action === "kill") return `kill process ${args.processId}`;
    return `check process ${args.processId}`;
  }
  return "(unknown command)";
}

function getStructuredResult(result: unknown): BashResult | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return result as BashResult;
}

function isErrorResult(result: unknown, structured: BashResult | null): boolean {
  if (structured?.status === "error" || structured?.status === "blocked" || typeof structured?.error === "string") {
    return true;
  }
  const text = parseTextResult(result);
  if (text && /^(error|command not found|bash:|zsh:)/im.test(text.slice(0, 200))) return true;
  return false;
}

/**
 * Custom UI for Claude Code's `Bash` tool.
 * Prefer structured stdout/stderr/error fields when available so command
 * failures render the real shell details instead of a generic error banner.
 */
export const ClaudeBashToolUI: ToolCallContentPartComponent = ({ args, result }) => {
  const structured = getStructuredResult(result);
  const command = getCommandLabel(args);
  const outputText = parseTextResult(result);
  const hasError = isErrorResult(result, structured);
  const isRunning = result === undefined;

  const stdout = structured?.stdout ?? (!hasError ? outputText : undefined);
  const stderr = structured?.stderr;
  const inlineDiff = structured?.inlineDiff;
  const errorMsg = structured?.error ?? (hasError ? outputText : undefined);
  const executionTime = structured?.executionTime;
  const exitCode = structured?.exitCode;
  const logId = structured?.logId;
  const isTruncated = structured?.isTruncated;

  const expansionCtx = useToolExpansion();
  const lastSignalRef = useRef(0);
  const [forceCollapse, setForceCollapse] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!expansionCtx || expansionCtx.signal.counter === 0) return;
    if (expansionCtx.signal.counter === lastSignalRef.current) return;
    lastSignalRef.current = expansionCtx.signal.counter;
    setForceCollapse(expansionCtx.signal.mode !== "expand");
  }, [expansionCtx?.signal]);

  const autoCollapse = !hasError && !isRunning && !!stdout && stdout.length < 500 && !stderr;

  return (
    <CommandOutput
      command={command}
      stdout={stdout}
      stderr={stderr}
      inlineDiff={inlineDiff}
      error={errorMsg}
      exitCode={exitCode}
      executionTime={executionTime}
      success={!hasError && !isRunning}
      logId={logId}
      isTruncated={isTruncated}
      defaultCollapsed={forceCollapse ?? autoCollapse}
    />
  );
};
