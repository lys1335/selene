"use client";

/**
 * Shared base components and utilities for Claude Code tool UIs.
 *
 * All the full-size expandable tool cards share:
 * - A card container with consistent styling
 * - A collapsible header button with status icon + chevron
 * - Global expand/collapse signal from ToolExpansionContext
 *
 * Use `ClaudeToolCard` as the outer shell and pass `headerContent` for
 * the tool-specific icon, label, main text, and badges. Put the expanded
 * body content as `children`.
 */

import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { CheckCircleIcon, XCircleIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolExpansion } from "../tool-expansion-context";
import { parseTextResult } from "./parse-text-result";

// ─── Shared hook ─────────────────────────────────────────────────────────────

/**
 * Subscribes to the global tool expansion signal and keeps a local
 * `expanded` boolean in sync. Returns `[expanded, setExpanded]`.
 */
export function useToolCardExpansion(initialExpanded = false): [boolean, (v: boolean) => void] {
  const [expanded, setExpanded] = useState(initialExpanded);
  const expansionCtx = useToolExpansion();
  const lastSignalRef = useRef(0);

  useEffect(() => {
    if (!expansionCtx || expansionCtx.signal.counter === 0) return;
    if (expansionCtx.signal.counter === lastSignalRef.current) return;
    lastSignalRef.current = expansionCtx.signal.counter;
    setExpanded(expansionCtx.signal.mode === "expand");
  }, [expansionCtx?.signal]);

  return [expanded, setExpanded];
}

// ─── Shared error detection ───────────────────────────────────────────────────

/**
 * Baseline error detection that works for most Claude Code tools.
 * Pass an optional `errorPattern` to extend the text-matching heuristic.
 */
export function isToolErrorResult(
  result: unknown,
  errorPattern: RegExp = /^(error|failed)/im,
): boolean {
  if (!result) return false;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.isError === true) return true;
  }
  const text = parseTextResult(result);
  if (text && errorPattern.test(text.slice(0, 200))) return true;
  return false;
}

/** Derived color class for a tool's current status. */
export function toolStatusColor(isRunning: boolean, hasError: boolean): string {
  if (isRunning) return "text-terminal-muted";
  if (hasError) return "text-red-600 dark:text-red-400";
  return "text-emerald-600 dark:text-emerald-400";
}

// ─── Shared pre block ─────────────────────────────────────────────────────────

interface ToolCardPreProps {
  children: ReactNode;
  className?: string;
}

/**
 * The standard monospace pre block used in all tool card expanded bodies.
 */
export const ToolCardPre: FC<ToolCardPreProps> = ({ children, className }) => (
  <pre
    className={cn(
      "rounded bg-terminal-dark/5 dark:bg-terminal-dark/[0.06] p-2 overflow-x-auto",
      "text-terminal-dark dark:text-terminal-dark/90 whitespace-pre-wrap break-all font-mono text-[11px]",
      className,
    )}
  >
    {children}
  </pre>
);

// ─── Shared error text ────────────────────────────────────────────────────────

interface ToolCardErrorProps {
  content: string | null | undefined;
  maxChars?: number;
}

/** Standard error text block shown inside an expanded tool card. */
export const ToolCardError: FC<ToolCardErrorProps> = ({ content, maxChars = 500 }) => {
  if (!content) return null;
  return (
    <div className="text-[11px] text-red-600 dark:text-red-400">
      {content.slice(0, maxChars)}
    </div>
  );
};

// ─── Main card component ──────────────────────────────────────────────────────

interface ClaudeToolCardProps {
  /** Controls loading/error state for status icon and colors. */
  isRunning: boolean;
  hasError: boolean;

  /**
   * Content rendered inside the header button, between the status icon and the
   * chevron. Typically: tool icon, label span, main-text span, badge spans.
   */
  headerContent: ReactNode;

  /**
   * Body content shown when the card is expanded. Rendered inside a `div` with
   * `border-t border-border px-3 py-2 space-y-2`.
   */
  children?: ReactNode;

  /**
   * Override the running-state indicator. By default a pulsing circle is shown.
   * Pass a custom element (e.g. an animated spinner icon) when needed.
   */
  runningIndicator?: ReactNode;

  className?: string;
}

/**
 * Full-size expandable tool card shell used by all Claude Code tool UIs.
 *
 * Handles:
 * - Card container styling
 * - Collapse/expand toggle (local + global signal)
 * - Status icon (check / x / pulse)
 * - Chevron indicator
 */
export const ClaudeToolCard: FC<ClaudeToolCardProps> = ({
  isRunning,
  hasError,
  headerContent,
  children,
  runningIndicator,
  className,
}) => {
  const [expanded, setExpanded] = useToolCardExpansion(false);

  const StatusIcon = isRunning ? null : hasError ? XCircleIcon : CheckCircleIcon;
  const statusColor = toolStatusColor(isRunning, hasError);

  const defaultRunningIndicator = (
    <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-terminal-muted animate-pulse" />
  );

  return (
    <div
      className={cn(
        "my-1 rounded-md border border-border bg-terminal-cream/50 dark:bg-terminal-cream/80 font-mono text-xs overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors text-left"
      >
        {StatusIcon
          ? <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />
          : (runningIndicator ?? defaultRunningIndicator)}

        {headerContent}

        {expanded
          ? <ChevronDownIcon className="h-3 w-3 shrink-0 text-terminal-muted" />
          : <ChevronRightIcon className="h-3 w-3 shrink-0 text-terminal-muted" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
};
