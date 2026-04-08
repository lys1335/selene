"use client";

import { memo } from "react";
import type { FC } from "react";
import {
  Save,
  Search,
  Eye,
  Star,
  RotateCcw,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ToolCallContentPartComponent = FC<{
  toolName: string;
  argsText?: string;
  args?: {
    action?: string;
    name?: string;
    query?: string;
    componentId?: string;
  };
  result?: {
    success?: boolean;
    action?: string;
    data?: {
      component?: { name?: string; id?: string };
      components?: { name?: string; id?: string }[];
      count?: number;
      message?: string;
    };
    error?: string;
  };
}>;

function getActionIcon(action?: string) {
  switch (action) {
    case "save":
      return Save;
    case "search":
      return Search;
    case "get":
      return Eye;
    case "favorite":
      return Star;
    case "reuse":
      return RotateCcw;
    case "delete":
      return Trash2;
    default:
      return Save;
  }
}

function getActionLabel(action?: string): string {
  switch (action) {
    case "save":
      return "Save to gallery";
    case "search":
      return "Search gallery";
    case "get":
      return "View component";
    case "favorite":
      return "Toggle favorite";
    case "reuse":
      return "Reuse component";
    case "delete":
      return "Delete component";
    default:
      return action || "Design gallery";
  }
}

export const DesignGalleryToolUI: ToolCallContentPartComponent = memo(
  ({ args, result }) => {
    const action = args?.action || result?.action;
    const isRunning = result === undefined;
    const success = result?.success === true;
    const error = result?.success === false ? result.error : null;
    const Icon = getActionIcon(action);

    return (
      <div
        className={cn(
          "my-3 rounded-lg border p-4 font-mono shadow-sm",
          isRunning && "border-terminal-dark/10 bg-terminal-cream",
          success && "border-emerald-200 bg-emerald-50/60",
          error && "border-destructive/20 bg-destructive/5"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              isRunning && "bg-terminal-dark/5",
              success && "bg-emerald-100 text-emerald-700",
              error && "bg-destructive/10 text-destructive"
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
            <div className="text-sm font-medium text-terminal-dark">
              {getActionLabel(action)}
            </div>
            <div className="mt-0.5 text-xs text-terminal-muted break-words [overflow-wrap:anywhere]">
              {isRunning
                ? "Running..."
                : result?.data?.message || error || "Completed"}
            </div>
          </div>
        </div>

        {result?.data?.count !== undefined && action === "search" && (
          <div className="mt-3 text-xs text-terminal-muted">
            Results:{" "}
            <span className="text-terminal-dark">{result.data.count}</span>
          </div>
        )}

        {result?.data?.component?.name && (
          <div className="mt-3 text-xs text-terminal-muted">
            Component:{" "}
            <span className="text-terminal-dark">
              {result.data.component.name}
            </span>
          </div>
        )}
      </div>
    );
  }
);

DesignGalleryToolUI.displayName = "DesignGalleryToolUI";
