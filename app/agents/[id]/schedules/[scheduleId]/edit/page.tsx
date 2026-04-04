"use client";

import { use } from "react";
import { SchedulePageShell } from "@/components/schedules/schedule-page-shell";
import { useTranslations } from "next-intl";
import { useScheduleCharacter } from "@/hooks/use-schedule-character";
import type { ScheduledTask } from "@/lib/db/sqlite-schedule-schema";

export default function EditSchedulePage({
    params,
}: {
    params: Promise<{ id: string; scheduleId: string }>;
}) {
    const { id: characterId, scheduleId } = use(params);
    const t = useTranslations("schedules");

    const { agentName, schedule, isLoading, error } = useScheduleCharacter({
        characterId,
        scheduleId,
    });

    const handleUpdate = async (data: Partial<ScheduledTask>) => {
        const res = await fetch(`/api/schedules/${scheduleId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || t("updateScheduleFailed"));
        }
    };

    return (
        <SchedulePageShell
            characterId={characterId}
            scheduleId={scheduleId}
            agentName={agentName}
            schedule={schedule}
            isLoading={isLoading}
            error={error}
            backHref={`/agents/${characterId}/schedules`}
            onSubmit={handleUpdate}
        />
    );
}
