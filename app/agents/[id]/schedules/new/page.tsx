"use client";

import { use } from "react";
import { SchedulePageShell } from "@/components/schedules/schedule-page-shell";
import { useTranslations } from "next-intl";
import { useScheduleCharacter } from "@/hooks/use-schedule-character";
import type { ScheduledTask } from "@/lib/db/sqlite-schedule-schema";

export default function NewSchedulePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: characterId } = use(params);
    const t = useTranslations("schedules");

    const { agentName, isLoading, error } = useScheduleCharacter({ characterId });

    const handleCreate = async (data: Partial<ScheduledTask>) => {
        const res = await fetch("/api/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, characterId }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || t("createFailed"));
        }
    };

    return (
        <SchedulePageShell
            characterId={characterId}
            agentName={agentName}
            schedule={null}
            isLoading={isLoading}
            error={error}
            backHref="/"
            onSubmit={handleCreate}
        />
    );
}
