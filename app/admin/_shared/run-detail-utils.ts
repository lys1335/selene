/**
 * Shared types and utilities for run detail pages.
 * Used by both /admin/observability/runs/[id] and /admin/runs/[id].
 */
import type { AgentRun, AgentRunEvent, AgentRunStatus } from "@/lib/db/sqlite-schema";

export interface RunDetailResponse {
  run: AgentRun;
  events: AgentRunEvent[];
}

export const STATUS_COLORS: Record<AgentRunStatus, string> = {
  running: "bg-yellow-500",
  succeeded: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-500",
};

export function formatDuration(ms: number | null): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString();
}
