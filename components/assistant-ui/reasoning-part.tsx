"use client";

import { type FC, useState, useEffect, useRef, useCallback } from "react";
import { ChevronRightIcon, BrainIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Props passed by assistant-ui's MessagePrimitive.Content for reasoning parts.
 * The part has { type: "reasoning", text: string } plus a status field.
 */
interface ReasoningPartProps {
  type: "reasoning";
  text: string;
  status?: { type: string };
}

/**
 * Reasoning/thinking content display for LLM reasoning traces.
 *
 * Shows as a collapsible accordion:
 * - While streaming: expanded, shows "Thinking..." with a pulsing indicator
 * - When done: collapses automatically, shows "Thought for Xs"
 *
 * Uses the terminal design system (font-mono, terminal-* colors).
 */
export const ReasoningPart: FC<ReasoningPartProps> = ({ text, status }) => {
  const isStreaming = status?.type === "in_progress" || status?.type === "running";
  const [isOpen, setIsOpen] = useState(true);
  const [thinkingDuration, setThinkingDuration] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const hasCollapsedRef = useRef(false);

  // Track thinking duration while streaming
  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setThinkingDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming]);

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming && !hasCollapsedRef.current && text.length > 0) {
      hasCollapsedRef.current = true;
      // Brief delay so the user sees the final state before collapse
      const timeout = setTimeout(() => setIsOpen(false), 600);
      return () => clearTimeout(timeout);
    }
  }, [isStreaming, text]);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Don't render if there's no text and we're not streaming
  if (!text && !isStreaming) {
    return null;
  }

  const headerLabel = isStreaming
    ? "Thinking..."
    : thinkingDuration > 0
      ? `Thought for ${thinkingDuration}s`
      : "Thought";

  return (
    <div className="my-1.5 rounded-lg border border-terminal-border/40 bg-terminal-dark/[0.03] dark:bg-terminal-cream/[0.03]">
      {/* Accordion trigger */}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs",
          "text-terminal-muted transition-colors hover:text-terminal-dark dark:hover:text-terminal-cream",
          "select-none cursor-pointer rounded-lg",
        )}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            isOpen && "rotate-90",
          )}
        />

        <BrainIcon className="size-3.5 shrink-0" />

        <span className="flex items-center gap-2">
          {headerLabel}
          {isStreaming && (
            <span className="reasoning-pulse-dot inline-block size-1.5 rounded-full bg-terminal-muted" />
          )}
        </span>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="reasoning-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "border-t border-terminal-border/30 px-3 py-2.5",
                "font-mono text-xs leading-relaxed",
                "text-terminal-muted whitespace-pre-wrap break-words",
                "max-h-[20rem] overflow-y-auto",
              )}
            >
              {text || (
                <span className="italic opacity-60">Reasoning...</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
