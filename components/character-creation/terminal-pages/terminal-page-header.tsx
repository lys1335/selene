"use client";

import { type RefObject } from "react";
import { motion } from "framer-motion";
import { ComputerGraphic } from "../computer-graphic";
import { TypewriterText } from "@/components/ui/typewriter-text";
import { TerminalPrompt } from "@/components/ui/terminal-prompt";

interface TerminalPageHeaderProps {
  /** e.g. "step-1", "step-2" */
  step: string;
  /** The terminal command line rendered inside the prompt */
  command: React.ReactNode;
  /** Question text to typewrite on first render */
  question: string;
  prefersReducedMotion: boolean;
  hasAnimated: RefObject<boolean>;
  onAnimationComplete: () => void;
}

export function TerminalPageHeader({
  step,
  command,
  question,
  prefersReducedMotion,
  hasAnimated,
  onAnimationComplete,
}: TerminalPageHeaderProps) {
  return (
    <div className="flex items-start gap-8">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.5 }}
      >
        <ComputerGraphic size="sm" />
      </motion.div>

      <div className="flex-1 space-y-4">
        <TerminalPrompt prefix={step} symbol="$" animate={!prefersReducedMotion}>
          {command}
        </TerminalPrompt>

        <div className="font-mono text-lg text-terminal-dark">
          {!hasAnimated.current ? (
            <TypewriterText
              text={question}
              delay={prefersReducedMotion ? 0 : 200}
              speed={prefersReducedMotion ? 0 : 25}
              onComplete={() => {
                hasAnimated.current = true;
                onAnimationComplete();
              }}
              showCursor={false}
            />
          ) : (
            <span>{question}</span>
          )}
        </div>
      </div>
    </div>
  );
}
