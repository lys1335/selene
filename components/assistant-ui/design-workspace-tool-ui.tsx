"use client";

import { memo, useEffect } from "react";
import type { FC } from "react";
import { Sparkles, PenSquare, Save, RotateCcw, Download, PanelRightOpen, PanelRightClose, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dispatchDesignToolResult } from "@/components/design";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    action?: string;
    prompt?: string;
    mode?: string;
    style?: string;
    editPrompt?: string;
    inlineMode?: boolean;
    label?: string;
    snapshotId?: string;
    format?: string;
  };
  result?: {
    success?: boolean;
    action?: string;
    data?: {
      componentId?: string;
      code?: string;
      name?: string;
      snapshotId?: string;
      format?: string;
      message?: string;
      prompt?: string;
      mode?: string;
      style?: string;
    };
    error?: string;
  };
}>;

function getActionIcon(action?: string) {
  switch (action) {
    case "generate":
      return Sparkles;
    case "edit":
      return PenSquare;
    case "snapshot":
      return Save;
    case "restore":
      return RotateCcw;
    case "export":
      return Download;
    case "open":
      return PanelRightOpen;
    case "close":
      return PanelRightClose;
    default:
      return Sparkles;
  }
}

function getActionLabel(action?: string): string {
  switch (action) {
    case "generate":
      return "Generate component";
    case "edit":
      return "Edit component";
    case "snapshot":
      return "Take snapshot";
    case "restore":
      return "Restore snapshot";
    case "export":
      return "Export component";
    case "open":
      return "Open design workspace";
    case "close":
      return "Close design workspace";
    default:
      return action || "Design workspace";
  }
}

export const DesignWorkspaceToolUI: ToolCallContentPartComponent = memo(({ args, result }) => {
  const action = args?.action || result?.action;
  const isRunning = result === undefined;
  const success = result?.success === true;
  const error = result?.success === false ? result.error : null;
  const Icon = getActionIcon(action);

  useEffect(() => {
    if (!result || !action) return;
    dispatchDesignToolResult({
      action,
      success: Boolean(result.success),
      data: result.data,
      error: result.error,
    });
  }, [action, result]);

  return (
    <div
      className={cn(
        "my-3 rounded-lg border p-4 font-mono shadow-sm",
        isRunning && "border-terminal-dark/10 bg-terminal-cream",
        success && "border-emerald-200 bg-emerald-50/60",
        error && "border-destructive/20 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            isRunning && "bg-terminal-dark/5",
            success && "bg-emerald-100 text-emerald-700",
            error && "bg-destructive/10 text-destructive",
          )}
        >
          {isRunning ? (
            <Icon className="h-4 w-4 animate-pulse" />
          ) : success ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-terminal-dark">{getActionLabel(action)}</div>
          <div className="mt-0.5 text-xs text-terminal-muted break-words [overflow-wrap:anywhere]">
            {isRunning
              ? "Running..."
              : result?.data?.message || error || "Completed"}
          </div>
        </div>
      </div>

      {args?.prompt && (
        <div className="mt-3 rounded-md bg-black/5 px-3 py-2 text-xs text-terminal-muted">
          Prompt: <span className="text-terminal-dark">{args.prompt}</span>
        </div>
      )}

      {result?.data?.name && result?.data?.componentId && (
        <div className="mt-3 text-xs text-terminal-muted">
          Component: <span className="text-terminal-dark">{result.data.name}</span>
        </div>
      )}
    </div>
  );
});

DesignWorkspaceToolUI.displayName = "DesignWorkspaceToolUI";
