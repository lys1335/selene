"use client";

import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import { ScheduleFormFullPage } from "@/components/schedules/schedule-form-full-page";
import { useTranslations } from "next-intl";
import type { ScheduledTask } from "@/lib/db/sqlite-schedule-schema";

interface SchedulePageShellProps {
    characterId: string;
    scheduleId?: string;
    /** Resolved from useScheduleCharacter */
    agentName: string | undefined;
    schedule: ScheduledTask | null | undefined;
    isLoading: boolean;
    error: string | null;
    /** Back URL used in error/not-found states */
    backHref: string;
    onSubmit: (data: Partial<ScheduledTask>) => Promise<void>;
}

/**
 * Shared shell for the new-schedule and edit-schedule pages.
 * Handles loading, error, and not-found states, then renders ScheduleFormFullPage.
 */
export function SchedulePageShell({
    characterId,
    scheduleId,
    agentName,
    schedule,
    isLoading,
    error,
    backHref,
    onSubmit,
}: SchedulePageShellProps) {
    const tc = useTranslations("common");

    if (isLoading) {
        return (
            <Shell hideNav>
                <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-terminal-green" />
                </div>
            </Shell>
        );
    }

    if (error) {
        return (
            <Shell hideNav>
                <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-4 max-w-md text-center">
                        <AlertCircle className="h-12 w-12 text-destructive" />
                        <h1 className="text-xl font-semibold font-mono">{error}</h1>
                        <Button asChild>
                            <Link href={backHref}>{tc("back")}</Link>
                        </Button>
                    </div>
                </div>
            </Shell>
        );
    }

    if (scheduleId && !schedule) {
        return (
            <Shell hideNav>
                <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-4 max-w-md text-center">
                        <AlertCircle className="h-12 w-12 text-destructive" />
                        <h1 className="text-xl font-semibold font-mono">Schedule not found</h1>
                        <Button asChild>
                            <Link href={backHref}>{tc("back")}</Link>
                        </Button>
                    </div>
                </div>
            </Shell>
        );
    }

    return (
        <Shell hideNav>
            <ScheduleFormFullPage
                characterId={characterId}
                characterName={agentName}
                schedule={schedule ?? undefined}
                onSubmit={onSubmit}
            />
        </Shell>
    );
}
