"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { ScheduledTask } from "@/lib/db/sqlite-schedule-schema";

interface CharacterBasic {
  id: string;
  name: string;
  displayName?: string | null;
}

interface UseScheduleCharacterOptions {
  characterId: string;
  scheduleId?: string;
}

interface UseScheduleCharacterResult {
  character: CharacterBasic | null;
  schedule: ScheduledTask | null;
  agentName: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * Loads character info (and optionally a specific schedule) for the schedule form pages.
 * Provides unified loading/error state so both new and edit pages share the same fetch logic.
 */
export function useScheduleCharacter({
  characterId,
  scheduleId,
}: UseScheduleCharacterOptions): UseScheduleCharacterResult {
  const t = useTranslations("schedules");

  const [character, setCharacter] = useState<CharacterBasic | null>(null);
  const [schedule, setSchedule] = useState<ScheduledTask | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const charResponse = await fetch(`/api/characters/${characterId}`);
        if (charResponse.ok) {
          const charData = await charResponse.json();
          setCharacter(charData.character);
        } else if (charResponse.status === 404) {
          setError(t("agentNotFound"));
          setIsLoading(false);
          return;
        } else if (charResponse.status === 403) {
          setError(t("accessDenied"));
          setIsLoading(false);
          return;
        }

        if (scheduleId) {
          const scheduleResponse = await fetch(`/api/schedules/${scheduleId}`);
          if (scheduleResponse.ok) {
            const scheduleData = await scheduleResponse.json();
            setSchedule(scheduleData.schedule);
          } else if (scheduleResponse.status === 404) {
            setError(t("scheduleNotFound"));
          } else if (scheduleResponse.status === 403) {
            setError(t("accessDenied"));
          }
        }
      } catch (err) {
        console.error("Failed to load data:", err);
        setError(t(scheduleId ? "loadScheduleFailed" : "loadFailed"));
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [characterId, scheduleId, t]);

  const agentName = character?.displayName || character?.name || "Agent";

  return { character, schedule, agentName, isLoading, error };
}
