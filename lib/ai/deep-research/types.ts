/**
 * Deep Research Types
 * 
 * Type definitions for the Deep Research mode, ported from ThinkDepth.ai's
 * Python implementation to TypeScript.
 */

// ============================================================================
// Research State Types
// ============================================================================

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  relevanceScore?: number;
}

export interface ResearchFinding {
  query: string;
  sources: ResearchSource[];
  summary: string;
  timestamp: Date;
}

export interface ResearchPlan {
  originalQuery: string;
  clarifiedQuery: string;
  researchQuestions: string[];
  scope: string;
  expectedSections: string[];
}

export interface DraftReport {
  content: string;
  iteration: number;
  informationGaps: string[];
  refinementSuggestions: string[];
}

export interface FinalReport {
  title: string;
  content: string;
  citations: ResearchSource[];
  generatedAt: Date;
}

export interface DeepResearchState {
  // Input
  userQuery: string;
  
  // Planning phase
  plan?: ResearchPlan;
  
  // Research phase
  findings: ResearchFinding[];
  totalSearches: number;
  completedSearches: number;
  
  // Report generation phase
  draftReport?: DraftReport;
  finalReport?: FinalReport;
  
  // Workflow state
  currentPhase: ResearchPhase;
  iteration: number;
  maxIterations: number;
  error?: string;
}

export type ResearchPhase = 
  | 'idle'
  | 'planning'
  | 'searching'
  | 'analyzing'
  | 'drafting'
  | 'refining'
  | 'finalizing'
  | 'complete'
  | 'error';

// ============================================================================
// Streaming Event Types
// ============================================================================

type DeepResearchEventType =
  | 'phase_change'
  | 'search_progress'
  | 'search_result'
  | 'analysis_update'
  | 'draft_update'
  | 'refinement_update'
  | 'final_report'
  | 'error'
  | 'complete';

interface BaseResearchEvent {
  type: DeepResearchEventType;
  timestamp: Date;
}

interface PhaseChangeEvent extends BaseResearchEvent {
  type: 'phase_change';
  phase: ResearchPhase;
  message: string;
}

interface SearchProgressEvent extends BaseResearchEvent {
  type: 'search_progress';
  completed: number;
  total: number;
  currentQuery: string;
}

interface SearchResultEvent extends BaseResearchEvent {
  type: 'search_result';
  finding: ResearchFinding;
}

interface AnalysisUpdateEvent extends BaseResearchEvent {
  type: 'analysis_update';
  message: string;
  progress?: number;
}

interface DraftUpdateEvent extends BaseResearchEvent {
  type: 'draft_update';
  draft: DraftReport;
}

interface RefinementUpdateEvent extends BaseResearchEvent {
  type: 'refinement_update';
  iteration: number;
  maxIterations: number;
  gaps: string[];
}

interface FinalReportEvent extends BaseResearchEvent {
  type: 'final_report';
  report: FinalReport;
}

interface ErrorEvent extends BaseResearchEvent {
  type: 'error';
  error: string;
  failedPhase?: Exclude<ResearchPhase, 'idle' | 'complete' | 'error'>;
  phaseMessage?: string;
  code?: string;
  debug?: {
    rawResponsePreview?: string;
    extractedJsonPreview?: string;
    parseMessage?: string;
  };
}

interface CompleteEvent extends BaseResearchEvent {
  type: 'complete';
  state: DeepResearchState;
}

export type DeepResearchEvent =
  | PhaseChangeEvent
  | SearchProgressEvent
  | SearchResultEvent
  | AnalysisUpdateEvent
  | DraftUpdateEvent
  | RefinementUpdateEvent
  | FinalReportEvent
  | ErrorEvent
  | CompleteEvent;

// ============================================================================
// Configuration Types
// ============================================================================

export interface DeepResearchConfig {
  maxSearchQueries: number;
  maxIterations: number;
  maxConcurrentSearches: number;
  searchProvider: 'tavily' | 'duckduckgo' | 'serper' | 'mock';
  modelProvider: 'anthropic' | 'openrouter' | 'codex' | 'blackboxai';
  researchModel?: string;
  sessionProvider?: 'anthropic' | 'openrouter' | 'codex' | 'claudecode' | 'antigravity' | 'kimi' | 'minimax' | 'ollama' | 'blackboxai' | 'vllm';
  abortSignal?: AbortSignal;
}

const DEFAULT_CONFIG: DeepResearchConfig = {
  maxSearchQueries: 10,
  maxIterations: 3,
  maxConcurrentSearches: 3,
  searchProvider: 'duckduckgo',
  modelProvider: 'anthropic',
};

