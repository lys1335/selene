"use client";

import { memo, useEffect, useRef } from "react";
import type { FC } from "react";
import { Sparkles, PenSquare, Save, RotateCcw, Download, PanelRightOpen, PanelRightClose, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dispatchDesignToolResult } from "@/components/design";
import { useChatSessionId } from "@/components/chat-provider";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  toolCallId?: string;
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
      previewHtml?: string;
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

export const DesignWorkspaceToolUI: ToolCallContentPartComponent = memo(({ args, result, toolCallId }) => {
  const action = args?.action || result?.action;
  const isRunning = result === undefined;
  const success = result?.success === true;
  const error = result?.success === false ? result.error : null;
  const Icon = getActionIcon(action);
  const dispatchedRef = useRef<string | null>(null);
  const sessionId = useChatSessionId();

  useEffect(() => {
    if (!result || !action) return;
    // Deduplicate: include sessionId to prevent stale dedup across session switches.
    // Use toolCallId for uniqueness (handles edit actions where componentId may
    // not be returned), fall back to action+id composite key.
    const baseKey = toolCallId
      ?? `${action}:${result.data?.componentId || ""}:${result.data?.snapshotId || ""}`;
    const key = sessionId ? `${sessionId}:${baseKey}` : baseKey;
    if (dispatchedRef.current === key) return;
    dispatchedRef.current = key;
    dispatchDesignToolResult({
      action,
      success: Boolean(result.success),
      sessionId: sessionId ?? undefined,
      data: result.data,
      error: result.error,
    });
  }, [action, result, sessionId, toolCallId]);

  return (
    <div
      className={cn(
        "my-3 rounded-lg border p-4 font-mono shadow-sm",
        isRunning && "border-border bg-muted/50",
        success && "border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30",
        error && "border-destructive/20 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            isRunning && "bg-muted",
            success && "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400",
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
          <div className="text-sm font-medium text-foreground">{getActionLabel(action)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">
            {isRunning
              ? "Running..."
              : result?.data?.message || error || "Completed"}
          </div>
        </div>
      </div>

      {args?.prompt && (
        <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Prompt: <span className="text-foreground">{args.prompt}</span>
        </div>
      )}

      {result?.data?.name && result?.data?.componentId && (
        <div className="mt-3 text-xs text-muted-foreground">
          Component: <span className="text-foreground">{result.data.name}</span>
        </div>
      )}
    </div>
  );
});

DesignWorkspaceToolUI.displayName = "DesignWorkspaceToolUI";
