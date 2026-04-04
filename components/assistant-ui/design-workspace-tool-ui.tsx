"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { FC } from "react";
import { Sparkles, PenSquare, Save, RotateCcw, Download, PanelRightOpen, PanelRightClose, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dispatchDesignToolResult } from "@/components/design";
import { useChatSessionId } from "@/components/chat-provider";
import { parseNestedJsonString } from "@/lib/utils/parse-nested-json";

type DesignWorkspaceResult = {
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
  status?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  output?: unknown;
  result?: unknown;
};

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
  result?: DesignWorkspaceResult | Record<string, unknown>;
  output?: DesignWorkspaceResult | Record<string, unknown> | string;
  state?: "input-streaming" | "input-available" | "output-available" | "output-error" | "output-denied";
  errorText?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed || undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const textParts = content
    .filter((item): item is { type?: string; text?: string } => isRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text!.trim())
    .filter(Boolean);

  if (textParts.length === 0) {
    return undefined;
  }

  return textParts.join("\n");
}

function normalizeDesignWorkspaceResult(
  raw: unknown,
  depth: number = 0,
  visited: WeakSet<object> = new WeakSet<object>(),
): DesignWorkspaceResult | undefined {
  if (depth > 6 || raw == null) {
    return undefined;
  }

  if (typeof raw === "string") {
    const parsed = parseNestedJsonString(raw);
    if (parsed !== undefined && parsed !== raw) {
      return normalizeDesignWorkspaceResult(parsed, depth + 1, visited);
    }
    return {
      success: true,
      status: "success",
      data: { message: raw },
      content: raw,
    };
  }

  if (Array.isArray(raw)) {
    const contentText = extractContentText(raw);
    if (!contentText) {
      return undefined;
    }
    return normalizeDesignWorkspaceResult({ content: raw, status: "success", data: { message: contentText } }, depth + 1, visited);
  }

  if (!isRecord(raw)) {
    return undefined;
  }

  if (visited.has(raw)) {
    return undefined;
  }
  visited.add(raw);

  const direct = raw as DesignWorkspaceResult;

  if (isRecord(direct.result)) {
    const nested = normalizeDesignWorkspaceResult(direct.result, depth + 1, visited);
    if (nested) return nested;
  }
  if (isRecord(direct.output)) {
    const nested = normalizeDesignWorkspaceResult(direct.output, depth + 1, visited);
    if (nested) return nested;
  }

  const contentText = extractContentText(direct.content);
  if (contentText) {
    const parsed = parseNestedJsonString(contentText);
    if (parsed !== undefined && parsed !== contentText) {
      const nested = normalizeDesignWorkspaceResult(parsed, depth + 1, visited);
      if (nested) return nested;
    }

    if (!direct.action && !direct.data && !direct.error && direct.success === undefined) {
      return {
        success: direct.status !== "error",
        status: typeof direct.status === "string" ? direct.status : "success",
        data: { message: contentText },
        content: direct.content,
      };
    }
  }

  if (typeof direct.action === "string" || direct.success !== undefined || isRecord(direct.data) || typeof direct.error === "string") {
    const status = typeof direct.status === "string"
      ? direct.status
      : direct.success === false || typeof direct.error === "string"
        ? "error"
        : "success";

    return {
      ...direct,
      status,
      success: typeof direct.success === "boolean" ? direct.success : status !== "error",
    };
  }

  return undefined;
}

export const DesignWorkspaceToolUI: ToolCallContentPartComponent = memo(({

  args,
  result,
  output,
  state,
  errorText,
  toolCallId,
}) => {
  const resolvedResult = useMemo(
    () => normalizeDesignWorkspaceResult(result ?? output),
    [output, result],
  );
  const action = args?.action || resolvedResult?.action;
  const isRunning = !resolvedResult && !errorText && !state?.startsWith("output");
  const success = resolvedResult?.success === true;
  const error = errorText || (resolvedResult?.success === false ? resolvedResult.error : null);
  const Icon = getActionIcon(action);
  const dispatchedRef = useRef<string | null>(null);
  const sessionId = useChatSessionId();

  useEffect(() => {
    if (!resolvedResult || !action) return;
    // Deduplicate: include sessionId to prevent stale dedup across session switches.
    // Use toolCallId for uniqueness (handles edit actions where componentId may
    // not be returned), fall back to action+id composite key.
    const baseKey = toolCallId
      ?? `${action}:${resolvedResult.data?.componentId || ""}:${resolvedResult.data?.snapshotId || ""}`;
    const key = sessionId ? `${sessionId}:${baseKey}` : baseKey;
    if (dispatchedRef.current === key) return;
    dispatchedRef.current = key;
    const detail = {
      action,
      success: Boolean(resolvedResult.success),
      sessionId: sessionId ?? undefined,
      data: resolvedResult.data,
      error: resolvedResult.error,
    };
    // Unidirectional flow: ToolUI → CustomEvent → Bridge → Store
    dispatchDesignToolResult(detail);
  }, [action, resolvedResult, sessionId, toolCallId]);

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
              : resolvedResult?.data?.message || error || "Completed"}
          </div>
        </div>
      </div>

      {args?.prompt && (
        <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Prompt: <span className="text-foreground">{args.prompt}</span>
        </div>
      )}

      {resolvedResult?.data?.name && resolvedResult?.data?.componentId && (
        <div className="mt-3 text-xs text-muted-foreground">
          Component: <span className="text-foreground">{resolvedResult.data.name}</span>
        </div>
      )}
    </div>
  );
});

DesignWorkspaceToolUI.displayName = "DesignWorkspaceToolUI";
