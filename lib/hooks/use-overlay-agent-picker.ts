"use client";
import { useState, useEffect, useCallback } from "react";
import type { OverlayAgent } from "@/app/api/overlay/agents/route";

const LOCAL_STORAGE_KEY = "overlay:lastAgentId";

export interface UseOverlayAgentPickerReturn {
  agents: OverlayAgent[];
  selectedAgent: OverlayAgent | null;
  selectAgent: (agent: OverlayAgent) => void;
  loading: boolean;
}

export function useOverlayAgentPicker(): UseOverlayAgentPickerReturn {
  const [agents, setAgents] = useState<OverlayAgent[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<OverlayAgent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents() {
      try {
        const res = await fetch("/api/overlay/agents");
        if (!res.ok) return;
        const data = await res.json() as { agents: OverlayAgent[]; defaultAgentId?: string };
        if (cancelled) return;

        setAgents(data.agents);
        setDefaultAgentId(data.defaultAgentId);

        // Restore last selection from localStorage
        let lastAgentId: string | null = null;
        try {
          lastAgentId = localStorage.getItem(LOCAL_STORAGE_KEY);
        } catch {}

        const pickById = (id: string) =>
          data.agents.find((a) => a.id === id) ?? null;

        const resolved =
          (lastAgentId ? pickById(lastAgentId) : null) ??
          (data.defaultAgentId ? pickById(data.defaultAgentId) : null) ??
          data.agents[0] ??
          null;

        setSelectedAgent(resolved);
      } catch {
        // Silently fail — the overlay should still be usable if agent list fails
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchAgents();
    return () => { cancelled = true; };
  }, []);

  const selectAgent = useCallback((agent: OverlayAgent) => {
    setSelectedAgent(agent);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, agent.id);
    } catch {}
  }, []);

  return { agents, selectedAgent, selectAgent, loading };
}
