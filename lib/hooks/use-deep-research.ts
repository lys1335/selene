/**
 * Deep Research React Hook
 *
 * Provides a React hook for managing deep research state and streaming.
 */

import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';
import { resilientFetch } from '@/lib/utils/resilient-fetch';
import type {
  DeepResearchEvent,
  ResearchPhase,
  FinalReport,
  ResearchFinding,
  DeepResearchConfig,
} from '@/lib/ai/deep-research/types';

type DeepResearchProgress = { completed: number; total: number; currentQuery: string } | null;

type DeepResearchErrorDebug = {
  rawResponsePreview?: string;
  extractedJsonPreview?: string;
  parseMessage?: string;
} | null;

interface PersistedDeepResearchState {
  runId: string;
  query: string;
  phase: ResearchPhase;
  phaseMessage: string;
  progress: DeepResearchProgress;
  findings: ResearchFinding[];
  finalReport: FinalReport | null;
  error: string | null;
  failedPhase?: Exclude<ResearchPhase, 'idle' | 'complete' | 'error'>;
  errorCode?: string;
  errorDebug?: DeepResearchErrorDebug;
  updatedAt: string;
}

interface DeepResearchErrorState {
  message: string | null;
  failedPhase: Exclude<ResearchPhase, 'idle' | 'complete' | 'error'> | null;
  code: string | null;
  debug: DeepResearchErrorDebug;
}

interface ActiveRunLookupResponse {
  hasActiveRun: boolean;
  runId?: string | null;
  pipelineName?: string | null;
  startedAt?: string | null;
  latestDeepResearchRunId?: string | null;
  latestDeepResearchStatus?: string | null;
  latestDeepResearchState?: PersistedDeepResearchState | null;
}

interface RunStatusResponse {
  status: string;
  pipelineName?: string;
  completedAt?: string | null;
  updatedAt?: string | null;
  isZombie?: boolean;
  deepResearchState?: PersistedDeepResearchState | null;
}

const POLL_INTERVAL_MS = 2000;
const DEEP_RESEARCH_STORAGE_PREFIX = 'selene:deep-research-state';
const DEEP_RESEARCH_COMPLETED_STATES = new Set(['succeeded', 'failed', 'cancelled']);

interface LocalDeepResearchSnapshot {
  phase: ResearchPhase;
  phaseMessage: string;
  progress: DeepResearchProgress;
  findings: ResearchFinding[];
  finalReport: FinalReport | null;
  error: string | null;
  errorState: DeepResearchErrorState;
  activeRunId: string | null;
  updatedAt: string;
}

function createInitialErrorState(): DeepResearchErrorState {
  return {
    message: null,
    failedPhase: null,
    code: null,
    debug: null,
  };
}

function hydrateErrorState(state?: Partial<DeepResearchErrorState> | null): DeepResearchErrorState {
  return {
    message: state?.message ?? null,
    failedPhase: state?.failedPhase ?? null,
    code: state?.code ?? null,
    debug: state?.debug ?? null,
  };
}

function formatDeepResearchErrorMessage(state: DeepResearchErrorState, fallback: string | null): string | null {
  const message = state.message ?? fallback;
  if (!message) {
    return null;
  }

  if (!state.failedPhase) {
    return message;
  }

  return `${state.failedPhase}: ${message}`;
}

function buildErrorStateFromPersisted(state: PersistedDeepResearchState): DeepResearchErrorState {
  return hydrateErrorState({
    message: state.error,
    failedPhase: state.failedPhase ?? null,
    code: state.errorCode ?? null,
    debug: state.errorDebug ?? null,
  });
}

function buildErrorStateFromEvent(event: Extract<DeepResearchEvent, { type: 'error' }>): DeepResearchErrorState {
  return hydrateErrorState({
    message: event.error,
    failedPhase: event.failedPhase ?? null,
    code: event.code ?? null,
    debug: event.debug ?? null,
  });
}

function buildErrorStateFromThrownError(errorMessage: string): DeepResearchErrorState {
  return hydrateErrorState({ message: errorMessage });
}

function clearDeepResearchErrorState(
  setErrorState: Dispatch<SetStateAction<DeepResearchErrorState>>,
  setError: Dispatch<SetStateAction<string | null>>,
): void {
  setErrorState(createInitialErrorState());
  setError(null);
}

function applyDeepResearchErrorState(
  nextState: DeepResearchErrorState,
  setErrorState: Dispatch<SetStateAction<DeepResearchErrorState>>,
  setError: Dispatch<SetStateAction<string | null>>,
): void {
  const hydrated = hydrateErrorState(nextState);
  setErrorState(hydrated);
  setError(formatDeepResearchErrorMessage(hydrated, hydrated.message));
}

function isPhaseActive(phase: ResearchPhase): boolean {
  return phase !== 'idle' && phase !== 'complete' && phase !== 'error';
}

function isPhaseTerminal(phase: ResearchPhase): boolean {
  return phase === 'complete' || phase === 'error' || phase === 'idle';
}

function getUserFacingPhaseMessage(state: DeepResearchErrorState, fallback: string): string {
  if (!state.failedPhase) {
    return fallback;
  }

  return `${state.failedPhase} failed`;
}

function getUserFacingErrorMessage(state: DeepResearchErrorState): string | null {
  if (!state.message) {
    return null;
  }

  switch (state.code) {
    case 'DEEP_RESEARCH_PLAN_INVALID_JSON':
      return 'The research planner returned malformed JSON. Check the deep research logs for the raw planner payload.';
    case 'DEEP_RESEARCH_PLAN_INVALID_SHAPE':
      return 'The research planner returned an incomplete plan payload.';
    case 'DEEP_RESEARCH_QUERY_INVALID_SHAPE':
      return 'The research query generator returned an invalid payload.';
    case 'DEEP_RESEARCH_REFINEMENT_INVALID_SHAPE':
      return 'The research refinement step returned an invalid payload.';
    default:
      return state.message;
  }
}

function getDebugSummary(state: DeepResearchErrorState): string | null {
  const parts = [state.code, state.debug?.parseMessage].filter(Boolean);
  return parts.length > 0 ? parts.join(' | ') : null;
}

function getStorageKey(sessionId?: string): string | null {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  return normalized ? `${DEEP_RESEARCH_STORAGE_PREFIX}:${normalized}` : null;
}

function readLocalSnapshot(storageKey: string | null): LocalDeepResearchSnapshot | null {
  if (!storageKey || typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LocalDeepResearchSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalSnapshot(storageKey: string | null, snapshot: LocalDeepResearchSnapshot | null): void {
  if (!storageKey || typeof window === 'undefined') {
    return;
  }

  try {
    if (!snapshot) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures (private mode/quota)
  }
}

export interface UseDeepResearchOptions {
  sessionId?: string;
  config?: Partial<DeepResearchConfig>;
  onComplete?: (report: FinalReport) => void;
  onError?: (error: string) => void;
}

export interface UseDeepResearchReturn {
  isActive: boolean;
  isLoading: boolean;
  phase: ResearchPhase;
  phaseMessage: string;
  progress: DeepResearchProgress;
  findings: ResearchFinding[];
  finalReport: FinalReport | null;
  error: string | null;
  errorState: DeepResearchErrorState;
  activeRunId: string | null;
  isBackgroundPolling: boolean;
  startResearch: (query: string) => Promise<void>;
  cancelResearch: () => void;
  reset: () => void;
  startPolling: (runId?: string | null) => void;
  stopPolling: () => void;
}

export function useDeepResearch(options: UseDeepResearchOptions = {}): UseDeepResearchReturn {
  const { sessionId, config, onComplete, onError } = options;

  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<ResearchPhase>('idle');
  const [phaseMessage, setPhaseMessage] = useState('');
  const [progress, setProgress] = useState<DeepResearchProgress>(null);
  const [findings, setFindings] = useState<ResearchFinding[]>([]);
  const [finalReport, setFinalReport] = useState<FinalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<DeepResearchErrorState>(createInitialErrorState());
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isBackgroundPolling, setIsBackgroundPolling] = useState(false);

  const storageKey = getStorageKey(sessionId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRunIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const phaseRef = useRef<ResearchPhase>('idle');
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingRunIdRef.current = null;
    setIsBackgroundPolling(false);
  }, []);

  const applyPersistedState = useCallback((state: PersistedDeepResearchState) => {
    const nextErrorState = buildErrorStateFromPersisted(state);
    setPhase(state.phase);
    setPhaseMessage(
      state.phase === 'error'
        ? getUserFacingPhaseMessage(nextErrorState, state.phaseMessage || 'Deep Research failed.')
        : (state.phaseMessage || '')
    );
    setProgress(state.progress ?? null);
    setFindings(Array.isArray(state.findings) ? state.findings : []);
    setFinalReport(state.finalReport ?? null);
    applyDeepResearchErrorState(nextErrorState, setErrorState, setError);
    setIsActive(isPhaseActive(state.phase));
    setIsLoading(isPhaseActive(state.phase));
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    writeLocalSnapshot(storageKey, {
      phase,
      phaseMessage,
      progress,
      findings,
      finalReport,
      error,
      errorState,
      activeRunId,
      updatedAt: new Date().toISOString(),
    });
  }, [activeRunId, error, errorState, finalReport, findings, phase, phaseMessage, progress, storageKey]);

  const reset = useCallback(() => {
    stopPolling();
    setIsActive(false);
    setIsLoading(false);
    setPhase('idle');
    setPhaseMessage('');
    setProgress(null);
    setFindings([]);
    setFinalReport(null);
    clearDeepResearchErrorState(setErrorState, setError);
    setActiveRunId(null);
    writeLocalSnapshot(storageKey, null);
  }, [stopPolling, storageKey]);

  const cancelResearch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const runIdToCancel = activeRunIdRef.current;
    if (runIdToCancel) {
      void resilientFetch(`/api/agent-runs/${runIdToCancel}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        retries: 0,
        timeout: 8000,
      });
    }

    stopPolling();
    setActiveRunId(null);
    setIsActive(false);
    setIsLoading(false);
    setPhase('idle');
    setPhaseMessage('Research cancelled');
    clearDeepResearchErrorState(setErrorState, setError);
  }, [stopPolling]);

  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const resolveDeepResearchRun = useCallback(async () => {
    if (!sessionId) {
      return null;
    }

    const { data } = await resilientFetch<ActiveRunLookupResponse>(
      `/api/sessions/${sessionId}/active-run`,
      { retries: 0, timeout: 8000 }
    );

    if (!data) {
      return null;
    }

    const runId = data.pipelineName === 'deep-research'
      ? data.runId ?? null
      : data.latestDeepResearchRunId ?? null;

    const status = data.pipelineName === 'deep-research'
      ? (data.hasActiveRun ? 'running' : null)
      : data.latestDeepResearchStatus ?? null;

    return {
      runId,
      status,
      state: data.latestDeepResearchState ?? null,
    };
  }, [sessionId]);

  const pollRunStatus = useCallback(async (runId: string): Promise<boolean> => {
    const { data, error } = await resilientFetch<RunStatusResponse>(`/api/agent-runs/${runId}/status`, {
      retries: 0,
      timeout: 8000,
    });

    if (error || !data) {
      return false;
    }

    if (data.deepResearchState) {
      applyPersistedState(data.deepResearchState);
    }

    const isRunning = data.status === 'running';
    setIsActive(isRunning);
    setIsLoading(isRunning);

    if (!isRunning) {
      stopPolling();
      setActiveRunId(null);

      if (data.deepResearchState?.finalReport) {
        onCompleteRef.current?.(data.deepResearchState.finalReport);
      }

      if (data.deepResearchState?.error) {
        const nextErrorState = buildErrorStateFromPersisted(data.deepResearchState);
        onErrorRef.current?.(getUserFacingErrorMessage(nextErrorState) ?? data.deepResearchState.error);
      }

      if (!data.deepResearchState?.finalReport && !data.deepResearchState?.error) {
        setIsActive(false);
        setIsLoading(false);
      }

      return true;
    }

    return false;
  }, [applyPersistedState, stopPolling]);

  const startPolling = useCallback((runId?: string | null) => {
    const targetRunId = runId ?? activeRunIdRef.current;
    if (!targetRunId) {
      return;
    }

    if (pollingRunIdRef.current === targetRunId && pollingIntervalRef.current) {
      return;
    }

    stopPolling();
    pollingRunIdRef.current = targetRunId;
    setActiveRunId(targetRunId);
    setIsBackgroundPolling(true);
    setIsActive(true);
    setIsLoading(true);

    void pollRunStatus(targetRunId);
    pollingIntervalRef.current = setInterval(() => {
      void pollRunStatus(targetRunId);
    }, POLL_INTERVAL_MS);
  }, [pollRunStatus, stopPolling]);

  const handleEvent = useCallback((event: DeepResearchEvent) => {
    console.log('[DEEP-RESEARCH-HOOK] Received event:', event.type, event);

    switch (event.type) {
      case 'phase_change':
        clearDeepResearchErrorState(setErrorState, setError);
        setPhase(event.phase);
        setPhaseMessage(event.message);
        break;
      case 'search_progress':
        setProgress({ completed: event.completed, total: event.total, currentQuery: event.currentQuery });
        break;
      case 'search_result':
        setFindings((prev) => [...prev, event.finding]);
        break;
      case 'final_report':
        clearDeepResearchErrorState(setErrorState, setError);
        setFinalReport(event.report);
        setPhase('complete');
        setPhaseMessage('Research complete');
        setIsActive(false);
        setIsLoading(false);
        onCompleteRef.current?.(event.report);
        break;
      case 'error': {
        const nextErrorState = buildErrorStateFromEvent(event);
        applyDeepResearchErrorState(nextErrorState, setErrorState, setError);
        setPhase('error');
        setPhaseMessage(getUserFacingPhaseMessage(nextErrorState, event.phaseMessage ?? 'Deep Research failed.'));
        setIsActive(false);
        setIsLoading(false);
        const debugSummary = getDebugSummary(nextErrorState);
        if (debugSummary) {
          console.error('[DEEP-RESEARCH-HOOK] Structured error:', debugSummary);
        }
        onErrorRef.current?.(getUserFacingErrorMessage(nextErrorState) ?? event.error);
        break;
      }
      case 'complete':
        setPhase((prev) => prev === 'error' ? prev : 'complete');
        setIsActive(false);
        setIsLoading(false);
        break;
    }
  }, []);

  const startResearch = useCallback(async (query: string) => {
    reset();
    setIsActive(true);
    setIsLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, sessionId, config }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start research');
      }

      const responseRunId = response.headers.get('X-Run-Id');
      if (responseRunId) {
        setActiveRunId(responseRunId);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let hasStreamActivity = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            console.log('[DEEP-RESEARCH-HOOK] Processing remaining buffer:', buffer);
          }
          break;
        }

        hasStreamActivity = true;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('[DEEP-RESEARCH-HOOK] Received [DONE] signal');
            continue;
          }

          try {
            const event: DeepResearchEvent = JSON.parse(data);
            handleEvent(event);
          } catch (parseError) {
            console.warn('[DEEP-RESEARCH-HOOK] Failed to parse event:', data, parseError);
          }
        }
      }

      console.log('[DEEP-RESEARCH-HOOK] Stream ended');

      const shouldStartPolling = !hasStreamActivity || !isPhaseTerminal(phaseRef.current);

      if (shouldStartPolling) {
        const fallbackRunId = activeRunIdRef.current;
        const resolved = await resolveDeepResearchRun();
        if (resolved?.state) {
          applyPersistedState(resolved.state);
        }

        if (resolved?.runId && resolved.status === 'running') {
          setActiveRunId(resolved.runId);
          startPolling(resolved.runId);
        } else if (fallbackRunId && !DEEP_RESEARCH_COMPLETED_STATES.has(resolved?.status ?? '')) {
          startPolling(fallbackRunId);
        } else {
          setActiveRunId(resolved?.runId ?? null);
          setIsActive(false);
          setIsLoading(false);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const nextErrorState = buildErrorStateFromThrownError(errorMessage);
      console.error('[DEEP-RESEARCH-HOOK] Error:', errorMessage);
      applyDeepResearchErrorState(nextErrorState, setErrorState, setError);
      setPhase('error');
      setPhaseMessage(getUserFacingPhaseMessage(nextErrorState, 'Deep Research failed.'));
      setIsActive(false);
      setIsLoading(false);
      onErrorRef.current?.(getUserFacingErrorMessage(nextErrorState) ?? errorMessage);
    } finally {
      abortControllerRef.current = null;
    }
  }, [applyPersistedState, config, handleEvent, reset, resolveDeepResearchRun, sessionId, startPolling]);

  useEffect(() => {
    if (!sessionId) {
      stopPolling();
      setActiveRunId(null);
      return;
    }

    const localSnapshot = readLocalSnapshot(storageKey);
    if (localSnapshot) {
      setPhase(localSnapshot.phase);
      setPhaseMessage(localSnapshot.phaseMessage || '');
      setProgress(localSnapshot.progress ?? null);
      setFindings(Array.isArray(localSnapshot.findings) ? localSnapshot.findings : []);
      setFinalReport(localSnapshot.finalReport ?? null);
      applyDeepResearchErrorState(localSnapshot.errorState, setErrorState, setError);
      if (localSnapshot.activeRunId) {
        setActiveRunId(localSnapshot.activeRunId);
      }
    }

    hasHydratedRef.current = true;

    let cancelled = false;

    const restore = async () => {
      const resolved = await resolveDeepResearchRun();
      if (cancelled || !resolved) {
        return;
      }

      if (resolved.state) {
        applyPersistedState(resolved.state);
      }

      if (!resolved.runId) {
        stopPolling();
        setActiveRunId(null);
        return;
      }

      setActiveRunId(resolved.runId);
      if (resolved.status === 'running') {
        startPolling(resolved.runId);
      } else {
        stopPolling();
      }
    };

    void restore();

    return () => {
      cancelled = true;
      hasHydratedRef.current = false;
      stopPolling();
    };
  }, [applyPersistedState, resolveDeepResearchRun, sessionId, startPolling, stopPolling, storageKey]);

  return {
    isActive,
    isLoading,
    phase,
    phaseMessage,
    progress,
    findings,
    finalReport,
    error,
    errorState,
    activeRunId,
    isBackgroundPolling,
    startResearch,
    cancelResearch,
    reset,
    startPolling,
    stopPolling,
  };
}
