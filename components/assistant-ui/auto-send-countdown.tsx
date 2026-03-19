"use client";

import type { FC } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SendHorizontalIcon } from "lucide-react";

interface AutoSendCountdownProps {
  remaining: number; // seconds remaining
  total: number;     // total countdown seconds
  onCancel: () => void;
  onSendNow: () => void;
  className?: string;
}

/**
 * Countdown progress bar shown during the "reviewing" phase of a unified
 * capture session when auto-send is enabled.
 *
 * Shows a progress bar, remaining time, Cancel button, and Send Now button.
 */
export const AutoSendCountdown: FC<AutoSendCountdownProps> = ({
  remaining,
  total,
  onCancel,
  onSendNow,
  className,
}) => {
  if (remaining <= 0 || total <= 0) return null;

  const progress = ((total - remaining) / total) * 100;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 border-b border-terminal-dark/10",
        "animate-in fade-in duration-200",
        className,
      )}
    >
      <div className="flex-1 h-1.5 bg-terminal-dark/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-terminal-green rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs font-mono text-terminal-muted tabular-nums whitespace-nowrap">
        Sending in {remaining}s...
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="h-6 px-2 text-xs font-mono text-terminal-muted hover:text-terminal-dark"
      >
        Cancel
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={onSendNow}
        className="h-6 px-2 text-xs font-mono"
      >
        <SendHorizontalIcon className="size-3 mr-1" />
        Send
      </Button>
    </div>
  );
};
