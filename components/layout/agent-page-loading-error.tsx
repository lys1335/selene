"use client";

import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";

interface AgentPageSpinnerProps {
  /** When true, renders a centered spinner inside a Shell. */
  loading: true;
}

interface AgentPageErrorProps {
  /** When true, renders an error state inside a Shell. */
  loading: false;
  /** Error message to display. */
  error: string;
  /** Label for the back link (e.g. from useTranslations("common")("back")). */
  backLabel: string;
}

type AgentPageGuardProps = AgentPageSpinnerProps | AgentPageErrorProps;

/**
 * Shared loading / error Shell wrapper used by agent sub-pages
 * (schedules, skills, etc.) before the main content is ready.
 */
export function AgentPageGuard(props: AgentPageGuardProps) {
  if (props.loading) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-terminal-green" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold font-mono">{props.error}</h1>
          <Button asChild>
            <Link href="/">{props.backLabel}</Link>
          </Button>
        </div>
      </div>
    </Shell>
  );
}
