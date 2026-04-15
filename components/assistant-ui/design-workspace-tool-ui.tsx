"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { FC } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  List,
  PanelRightClose,
  PanelRightOpen,
  PenSquare,
  RotateCcw,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dispatchDesignToolResult } from "@/components/design";
import { useChatSessionId } from "@/components/chat-provider";
import { parseNestedJsonString } from "@/lib/utils/parse-nested-json";
import type { DesignWorkspaceCompileReport } from "@/lib/design/workspace/config";
import type { DesignWorkspaceConfig } from "@/lib/design/workspace/config";
import type { DesignWorkspaceValidationResult } from "@/lib/design/workspace/config";
import type { DesignWorkspaceHistory } from "@/lib/design/workspace/edit-history";

type ValidationCheck = {
  name: string;
  status: "pass" | "fail" | "skip";
  message?: string;
};

interface HistoryActionSummary {
  seq?: number;
  action?: string;
  success?: boolean;
  durationMs?: number;
  error?: string;
}

interface HistorySummary extends Omit<DesignWorkspaceHistory, "actions"> {
  actions?: HistoryActionSummary[];
}

interface CompileReportSummary extends Omit<DesignWorkspaceCompileReport, "errors" | "dependencyCheck"> {
  errors?: Array<{ message?: string; suggestion?: string }>;
  dependencyCheck?: { missingPackages?: string[] };
}

interface ConfigSummary extends Partial<DesignWorkspaceConfig> {}

interface ValidationSummary extends Omit<DesignWorkspaceValidationResult, "checks"> {
  checks?: ValidationCheck[];
}

interface DesignWorkspaceResultData {
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
  missingPackages?: string[];
  autoRecoveryAttempted?: boolean;
  autoRecoveryResult?: "success" | "failed" | "not-needed";
  compileReport?: CompileReportSummary;
  postEditValidation?: ValidationSummary;
  history?: HistorySummary;
  config?: ConfigSummary;
  /** Project metadata fields (detect/browse/cast/open) */
  framework?: Record<string, unknown>;
  projectStructure?: Record<string, unknown>;
  castFile?: string;
  castMode?: "page" | "component" | "route";
  rendererInfo?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface DesignWorkspaceResult {
  success?: boolean;
  action?: string;
  data?: DesignWorkspaceResultData;
  error?: string;
  status?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  output?: unknown;
  result?: unknown;
}

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
    case "patch":
      return PenSquare;
    case "list":
      return List;
    case "status":
    case "readSource":
      return Search;
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
      return "Generate design";
    case "edit":
      return "Edit design";
    case "patch":
      return "Patch design";
    case "readSource":
      return "Read source";
    case "list":
      return "List designs";
    case "status":
      return "Inspect design";
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

function isDesignWorkspaceResultData(value: unknown): value is DesignWorkspaceResultData {
  return isRecord(value);
}

function toBridgeData(data: DesignWorkspaceResultData | undefined) {
  if (!data) {
    return undefined;
  }

  return {
    componentId: data.componentId,
    code: data.code,
    name: data.name,
    snapshotId: data.snapshotId,
    format: data.format,
    message: data.message,
    prompt: data.prompt,
    mode: data.mode,
    style: data.style,
    previewHtml: data.previewHtml,
    compileReport: data.compileReport as DesignWorkspaceCompileReport | undefined,
    postEditValidation: data.postEditValidation as DesignWorkspaceValidationResult | undefined,
    history: data.history as DesignWorkspaceHistory | undefined,
    config: data.config as DesignWorkspaceConfig | undefined,
    // Project metadata fields — pass through so the bridge can update the store
    framework: data.framework,
    projectStructure: data.projectStructure,
    castFile: data.castFile,
    castMode: data.castMode,
    rendererInfo: data.rendererInfo,
    metadata: data.metadata,
  };
}

function getMissingPackages(data: DesignWorkspaceResultData | undefined): string[] | undefined {
  const missingPackages = data?.missingPackages ?? data?.compileReport?.dependencyCheck?.missingPackages;
  return Array.isArray(missingPackages) && missingPackages.length > 0 ? missingPackages : undefined;
}

function shouldShowSource(action: string | undefined, code: string | undefined): boolean {
  if (!code) {
    return false;
  }

  return action === "generate" || action === "edit" || action === "patch";
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
    const baseKey = toolCallId
      ?? `${action}:${resolvedResult.data?.componentId || ""}:${resolvedResult.data?.snapshotId || ""}`;
    const key = sessionId ? `${sessionId}:${baseKey}` : baseKey;
    if (dispatchedRef.current === key) return;
    dispatchedRef.current = key;
    const detail = {
      action,
      success: Boolean(resolvedResult.success),
      sessionId: sessionId ?? undefined,
      data: toBridgeData(isDesignWorkspaceResultData(resolvedResult.data) ? resolvedResult.data : undefined),
      error: resolvedResult.error,
    };
    dispatchDesignToolResult(detail);
  }, [action, resolvedResult, sessionId, toolCallId]);

  const data = isDesignWorkspaceResultData(resolvedResult?.data) ? resolvedResult.data : undefined;
  const validation = data?.postEditValidation;
  const compileReport = data?.compileReport;
  const history = data?.history;
  const missingPackages = getMissingPackages(data);
  const showSource = shouldShowSource(action, data?.code);

  return (
    <div
      className={cn(
        "my-2 rounded-lg p-3 font-mono shadow-sm transition-all duration-150",
        "bg-terminal-cream/80",
        isRunning && "animate-pulse",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          isRunning ? "bg-terminal-green/10 text-terminal-green" : error ? "bg-red-50 text-red-600" : "bg-terminal-green/10 text-terminal-green",
        )}>
          {isRunning ? <Icon className="h-4 w-4 animate-pulse" /> : success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        </div>
        <span className="text-sm font-medium text-terminal-dark">{getActionLabel(action)}</span>
        <span className={cn(
          "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          isRunning ? "bg-terminal-green/10 text-terminal-green" : error ? "bg-red-50 text-red-600" : "bg-terminal-green/10 text-terminal-green",
        )}>
          {isRunning ? "running" : error ? "failed" : "done"}
        </span>
      </div>

      <div className="ml-10 break-words text-xs text-terminal-muted [overflow-wrap:anywhere]">
        {isRunning ? "Running..." : data?.message || error || "Completed"}
      </div>

      {error && (
        <div className="mt-2 rounded bg-red-50 p-2 text-xs font-mono text-red-600">
          {error}
        </div>
      )}

      {missingPackages && (
        <div className="mt-2 rounded bg-red-50 p-2 text-xs font-mono text-red-600">
          Missing packages: {missingPackages.join(", ")}
        </div>
      )}

      {compileReport?.errors && compileReport.errors.length > 0 && (
        <details className="mt-2 text-xs text-terminal-muted">
          <summary className="cursor-pointer hover:text-terminal-dark">Compilation details</summary>
          <div className="mt-1 space-y-1 rounded bg-terminal-dark/5 p-2 text-terminal-dark">
            {compileReport.errors.map((issue, index) => (
              <div key={`${issue.message || "issue"}-${index}`}>
                <div>{issue.message}</div>
                {issue.suggestion ? <div className="text-terminal-muted">{issue.suggestion}</div> : null}
              </div>
            ))}
          </div>
        </details>
      )}

      {validation && (
        <details className="mt-2 text-xs text-terminal-muted">
          <summary className="cursor-pointer hover:text-terminal-dark">
            Post-edit checks ({validation.passed ? "passed" : "issues found"})
          </summary>
          <div className="mt-1 space-y-1 rounded bg-terminal-dark/5 p-2 text-terminal-dark">
            {(validation.checks ?? []).map((check, index) => (
              <div key={`${check.name}-${index}`} className="flex items-start gap-2">
                <span className={cn(
                  "mt-0.5 inline-block h-2 w-2 rounded-full",
                  check.status === "pass" ? "bg-terminal-green" : check.status === "fail" ? "bg-red-500" : "bg-terminal-muted",
                )} />
                <div>
                  <div>{check.name}</div>
                  {check.message ? <div className="text-terminal-muted">{check.message}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {history?.actions && history.actions.length > 0 && action === "close" && (
        <details className="mt-2 text-xs text-terminal-muted">
          <summary className="cursor-pointer hover:text-terminal-dark">
            Workspace history ({history.actions.length} actions)
          </summary>
          <div className="mt-1 space-y-1 rounded bg-terminal-dark/5 p-2 text-terminal-dark">
            {history.actions.map((record, index) => (
              <div key={`${record.seq ?? index}-${record.action ?? "action"}`} className="flex items-center gap-2">
                <span className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  record.success ? "bg-terminal-green" : "bg-red-500",
                )} />
                <span>{record.action ?? "action"}</span>
                {typeof record.durationMs === "number" ? <span className="text-terminal-muted">{record.durationMs}ms</span> : null}
                {record.error ? <span className="text-red-600">{record.error}</span> : null}
              </div>
            ))}
          </div>
        </details>
      )}

      {showSource && data?.code && (
        <details className="mt-2 text-xs text-terminal-muted">
          <summary className="cursor-pointer hover:text-terminal-dark">Source</summary>
          <pre className="mt-1 max-h-96 overflow-auto rounded bg-terminal-dark/5 p-2 text-terminal-dark whitespace-pre-wrap [overflow-wrap:anywhere]">
            {data.code}
          </pre>
        </details>
      )}

      {args?.prompt && (
        <div className="mt-3 rounded-md bg-terminal-dark/5 px-3 py-2 text-xs text-terminal-muted">
          Prompt: <span className="text-terminal-dark">{args.prompt}</span>
        </div>
      )}

      {data?.name && data?.componentId && (
        <div className="mt-3 text-xs text-terminal-muted">
          Component: <span className="text-terminal-dark">{data.name}</span>
        </div>
      )}
    </div>
  );
});

DesignWorkspaceToolUI.displayName = "DesignWorkspaceToolUI";
