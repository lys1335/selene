"use client";

import { createContext, useContext, useState, type FC, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types (mirrored from server-side PlanContextState — keep in sync)
// ---------------------------------------------------------------------------

export interface PlanContextStep {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed" | "canceled";
}

export interface PlanContextState {
  version: number;
  steps: PlanContextStep[];
  explanation?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PlanContextValue {
  plan: PlanContextState | null;
  setPlan: (plan: PlanContextState | null) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface PlanProviderProps {
  children: ReactNode;
  /** Initial plan loaded from session metadata on page load. */
  initialPlan?: PlanContextState | null;
}

const PlanProvider: FC<PlanProviderProps> = ({ children, initialPlan = null }) => {
  const [plan, setPlan] = useState<PlanContextState | null>(initialPlan);

  return (
    <PlanContext.Provider value={{ plan, setPlan }}>
      {children}
    </PlanContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Use inside a PlanProvider. Throws if provider is missing. */
function usePlanContext(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    throw new Error("usePlanContext must be used within a <PlanProvider>");
  }
  return ctx;
}

/** Safe variant — returns null when no provider is present. */
function useOptionalPlan(): PlanContextValue | null {
  return useContext(PlanContext);
}
