/**
 * Deep Research Orchestrator
 * 
 * Main coordinator for the deep research workflow.
 * Implements the self-balancing research algorithm inspired by ThinkDepth.ai.
 */

import { generateText } from 'ai';
import { getModelByName, getResearchModel } from '../providers';
import { getSessionProviderTemperatureForSession } from '../session-model-resolver';
import { executeSearches, isSearchAvailable } from './search';
import {
  RESEARCH_PLANNER_PROMPT,
  SEARCH_QUERY_GENERATOR_PROMPT,
  DRAFT_REPORT_PROMPT,
  REPORT_REFINEMENT_PROMPT,
  FINAL_REPORT_PROMPT,
} from './prompts';
import { getTemporalContextBlock } from '../datetime-context';
import type {
  DeepResearchState,
  DeepResearchConfig,
  DeepResearchEvent,
  ResearchPlan,
  ResearchFinding,
  DraftReport,
  FinalReport,
} from './types';

export type EventEmitter = (event: DeepResearchEvent) => void;

interface ResearchGenerationConfig {
  model: ReturnType<typeof getResearchModel>;
  temperature: number;
}

interface JsonParseDebugInfo {
  rawResponsePreview: string;
  extractedJsonPreview?: string;
  parseMessage: string;
}

class DeepResearchPlanError extends Error {
  code: string;
  failedPhase: Exclude<DeepResearchState['currentPhase'], 'idle' | 'complete' | 'error'>;
  phaseMessage: string;
  debug: JsonParseDebugInfo;

  constructor(message: string, options: {
    code: string;
    failedPhase: Exclude<DeepResearchState['currentPhase'], 'idle' | 'complete' | 'error'>;
    phaseMessage: string;
    debug: JsonParseDebugInfo;
  }) {
    super(message);
    this.name = 'DeepResearchPlanError';
    this.code = options.code;
    this.failedPhase = options.failedPhase;
    this.phaseMessage = options.phaseMessage;
    this.debug = options.debug;
  }
}

async function resolveResearchGenerationConfig(config: Partial<DeepResearchConfig>): Promise<ResearchGenerationConfig> {
  let model = getResearchModel();
  if (config.researchModel) {
    try {
      model = getModelByName(config.researchModel);
    } catch (error) {
      console.warn(`[DEEP-RESEARCH] Failed to load session research model "${config.researchModel}", falling back to global:`, error);
    }
  }

  const requestedTemperature = await getSessionProviderTemperatureForSession(
    config.sessionProvider ? { sessionProvider: config.sessionProvider } : null,
    0.7
  );

  return {
    model,
    temperature: requestedTemperature,
  };
}

/**
 * Create initial research state
 */
function createInitialState(userQuery: string, config: Partial<DeepResearchConfig> = {}): DeepResearchState {
  return {
    userQuery,
    findings: [],
    totalSearches: 0,
    completedSearches: 0,
    currentPhase: 'idle',
    iteration: 0,
    maxIterations: config.maxIterations ?? 3,
  };
}

/**
 * Emit a phase change event
 */
function emitPhaseChange(emit: EventEmitter, phase: DeepResearchState['currentPhase'], message: string) {
  emit({
    type: 'phase_change',
    phase,
    message,
    timestamp: new Date(),
  });
}

/**
 * Extract the first complete JSON object or array from a string.
 * Uses brace/bracket counting to find the matching closing delimiter,
 * handling nested structures and strings with escaped characters.
 */
function extractJson(text: string): string {
  const candidateStarts = Array.from(text.matchAll(/[{\[]/g), (match) => match.index ?? -1)
    .filter((index) => index >= 0);

  if (candidateStarts.length === 0) {
    throw new SyntaxError('No JSON object or array found in response');
  }

  let lastError: Error | undefined;

  for (const startIdx of candidateStarts) {
    const openChar = text[startIdx];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(startIdx, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch (error) {
            lastError = error instanceof Error ? error : new SyntaxError('Invalid JSON candidate');
            break;
          }
        }
      }
    }

    if (!lastError) {
      lastError = new SyntaxError(
        `Unterminated JSON structure in response (started at index ${startIdx}): ${text.slice(startIdx, startIdx + 80)}...`
      );
    }
  }

  throw lastError ?? new SyntaxError('No valid JSON object or array found in response');
}

/**
 * Parse JSON from LLM response, handling markdown code blocks
 * and trailing commentary text that breaks JSON.parse.
 */
function parseJsonResponse<T>(text: string): { value: T; debug: JsonParseDebugInfo } {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```\w*\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return {
      value: JSON.parse(cleaned) as T,
      debug: {
        rawResponsePreview: cleaned.slice(0, 500),
        parseMessage: 'Parsed full response as JSON.',
      },
    };
  } catch (directParseError) {
    let jsonStr: string | undefined;

    try {
      jsonStr = extractJson(cleaned);
      return {
        value: JSON.parse(jsonStr) as T,
        debug: {
          rawResponsePreview: cleaned.slice(0, 500),
          extractedJsonPreview: jsonStr.slice(0, 500),
          parseMessage: directParseError instanceof Error
            ? directParseError.message
            : 'Direct JSON parse failed.',
        },
      };
    } catch (extractionError) {
      const parseMessage = extractionError instanceof Error
        ? extractionError.message
        : 'Failed to parse JSON response.';
      const directMessage = directParseError instanceof Error
        ? directParseError.message
        : 'Direct JSON parse failed.';
      throw new DeepResearchPlanError('Deep Research planner returned malformed JSON.', {
        code: 'DEEP_RESEARCH_PLAN_INVALID_JSON',
        failedPhase: 'planning',
        phaseMessage: 'Research plan generation failed.',
        debug: {
          rawResponsePreview: cleaned.slice(0, 500),
          extractedJsonPreview: jsonStr?.slice(0, 500),
          parseMessage: `${directMessage} | ${parseMessage}`,
        },
      });
    }
  }
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function validateResearchPlan(plan: unknown, originalQuery: string, debug: JsonParseDebugInfo): ResearchPlan {
  if (!plan || typeof plan !== 'object') {
    throw new DeepResearchPlanError('Deep Research planner returned an invalid plan payload.', {
      code: 'DEEP_RESEARCH_PLAN_INVALID_SHAPE',
      failedPhase: 'planning',
      phaseMessage: 'Research plan generation failed.',
      debug,
    });
  }

  const candidate = plan as Partial<Omit<ResearchPlan, 'originalQuery'>>;
  if (
    typeof candidate.clarifiedQuery !== 'string'
    || !isNonEmptyStringArray(candidate.researchQuestions)
    || typeof candidate.scope !== 'string'
    || !isNonEmptyStringArray(candidate.expectedSections)
  ) {
    throw new DeepResearchPlanError('Deep Research planner returned an incomplete plan payload.', {
      code: 'DEEP_RESEARCH_PLAN_INVALID_SHAPE',
      failedPhase: 'planning',
      phaseMessage: 'Research plan generation failed.',
      debug,
    });
  }

  return {
    originalQuery,
    clarifiedQuery: candidate.clarifiedQuery,
    researchQuestions: candidate.researchQuestions,
    scope: candidate.scope,
    expectedSections: candidate.expectedSections,
  };
}

/**
 * Phase 1: Create research plan
 */
async function planResearch(
  state: DeepResearchState,
  emit: EventEmitter,
  generationConfig: ResearchGenerationConfig,
  abortSignal?: AbortSignal
): Promise<ResearchPlan> {
  emitPhaseChange(emit, 'planning', 'Creating research plan...');

  // Include temporal context for accurate date awareness in research
  const temporalContext = getTemporalContextBlock();
  const systemPrompt = `${temporalContext}\n\n${RESEARCH_PLANNER_PROMPT}`;

  const { text } = await generateText({
    model: generationConfig.model,
    system: systemPrompt,
    prompt: `User Query: ${state.userQuery}\n\nCreate a comprehensive research plan.`,
    temperature: generationConfig.temperature,
    abortSignal,
  });

  const { value, debug } = parseJsonResponse<Omit<ResearchPlan, 'originalQuery'>>(text);
  return validateResearchPlan(value, state.userQuery, debug);
}

function validateQueryGenerationResult(result: unknown, debug: JsonParseDebugInfo): { queries: string[] } {
  if (!result || typeof result !== 'object' || !isNonEmptyStringArray((result as { queries?: unknown }).queries)) {
    throw new DeepResearchPlanError('Deep Research query generator returned an invalid payload.', {
      code: 'DEEP_RESEARCH_QUERY_INVALID_SHAPE',
      failedPhase: 'planning',
      phaseMessage: 'Research query generation failed.',
      debug,
    });
  }

  return {
    queries: (result as { queries: unknown }).queries as string[],
  };
}

function validateRefinementAnalysis(
  result: unknown,
  debug: JsonParseDebugInfo
): { informationGaps: string[]; suggestedSearches: string[] } {
  if (!result || typeof result !== 'object') {
    throw new DeepResearchPlanError('Deep Research refinement analysis returned an invalid payload.', {
      code: 'DEEP_RESEARCH_REFINEMENT_INVALID_SHAPE',
      failedPhase: 'refining',
      phaseMessage: 'Research refinement failed.',
      debug,
    });
  }

  const candidate = result as { informationGaps?: unknown; suggestedSearches?: unknown };
  if (!Array.isArray(candidate.informationGaps) || !Array.isArray(candidate.suggestedSearches)) {
    throw new DeepResearchPlanError('Deep Research refinement analysis returned an incomplete payload.', {
      code: 'DEEP_RESEARCH_REFINEMENT_INVALID_SHAPE',
      failedPhase: 'refining',
      phaseMessage: 'Research refinement failed.',
      debug,
    });
  }

  return {
    informationGaps: candidate.informationGaps.filter((item): item is string => typeof item === 'string'),
    suggestedSearches: candidate.suggestedSearches.filter((item): item is string => typeof item === 'string'),
  };
}

function buildDeepResearchErrorEvent(error: unknown, fallbackMessage: string): DeepResearchEvent {
  if (error instanceof DeepResearchPlanError) {
    return {
      type: 'error',
      error: error.message,
      failedPhase: error.failedPhase,
      phaseMessage: error.phaseMessage,
      code: error.code,
      debug: error.debug,
      timestamp: new Date(),
    };
  }

  return {
    type: 'error',
    error: fallbackMessage,
    timestamp: new Date(),
  };
}

function logDeepResearchError(error: unknown, state: DeepResearchState): void {
  if (error instanceof DeepResearchPlanError) {
    console.error('[DEEP-RESEARCH] Structured failure:', {
      code: error.code,
      failedPhase: error.failedPhase,
      phaseMessage: error.phaseMessage,
      parseMessage: error.debug.parseMessage,
      rawResponsePreview: error.debug.rawResponsePreview,
      extractedJsonPreview: error.debug.extractedJsonPreview,
      userQuery: state.userQuery,
    });
    return;
  }

  console.error('[DEEP-RESEARCH] Failure:', error);
}

/**
 * Phase 2: Generate search queries from research questions
 */
async function generateSearchQueries(
  plan: ResearchPlan,
  emit: EventEmitter,
  generationConfig: ResearchGenerationConfig,
  abortSignal?: AbortSignal
): Promise<string[]> {
  emit({
    type: 'analysis_update',
    message: 'Generating search queries...',
    timestamp: new Date(),
  });

  // Include temporal context for date-aware query generation
  const temporalContext = getTemporalContextBlock();
  const systemPrompt = `${temporalContext}\n\n${SEARCH_QUERY_GENERATOR_PROMPT}`;

  const allQueries: string[] = [];

  for (const question of plan.researchQuestions) {
    checkAborted(abortSignal);
    const { text } = await generateText({
      model: generationConfig.model,
      system: systemPrompt,
      prompt: `Research Question: ${question}\n\nGenerate optimized search queries.`,
      temperature: generationConfig.temperature,
      abortSignal,
    });

    const { value, debug } = parseJsonResponse<{ queries: string[] }>(text);
    const result = validateQueryGenerationResult(value, debug);
    allQueries.push(...result.queries);
  }

  // Deduplicate and limit queries
  const uniqueQueries = [...new Set(allQueries)].slice(0, 15);
  return uniqueQueries;
}

/**
 * Phase 3: Execute searches
 */
async function executeResearchSearches(
  queries: string[],
  emit: EventEmitter,
  config: Partial<DeepResearchConfig>
): Promise<ResearchFinding[]> {
  emitPhaseChange(emit, 'searching', `Searching ${queries.length} queries...`);

  const findings = await executeSearches(queries, {
    maxConcurrent: config.maxConcurrentSearches ?? 3,
    maxResultsPerQuery: 5,
    abortSignal: config.abortSignal,
    onProgress: (completed, total, currentQuery) => {
      emit({
        type: 'search_progress',
        completed,
        total,
        currentQuery,
        timestamp: new Date(),
      });
    },
  });

  // Emit each finding
  for (const finding of findings) {
    emit({
      type: 'search_result',
      finding,
      timestamp: new Date(),
    });
  }

  return findings;
}

/**
 * Phase 4: Analyze findings and generate draft report
 */
async function generateDraftReport(
  plan: ResearchPlan,
  findings: ResearchFinding[],
  emit: EventEmitter,
  generationConfig: ResearchGenerationConfig,
  abortSignal?: AbortSignal
): Promise<DraftReport> {
  emitPhaseChange(emit, 'drafting', 'Writing draft report...');

  // Include temporal context for accurate date references in report
  const temporalContext = getTemporalContextBlock();
  const systemPrompt = `${temporalContext}\n\n${DRAFT_REPORT_PROMPT}`;

  // Compile all findings into context
  const findingsContext = findings
    .map((f) => {
      const sourcesText = f.sources
        .map((s) => `- [${s.title}](${s.url}): ${s.snippet}`)
        .join('\n');
      return `Query: ${f.query}\nSources:\n${sourcesText}`;
    })
    .join('\n\n---\n\n');

  const { text } = await generateText({
    model: generationConfig.model,
    system: systemPrompt,
    prompt: `Research Plan:
Original Query: ${plan.originalQuery}
Clarified Query: ${plan.clarifiedQuery}
Scope: ${plan.scope}
Expected Sections: ${plan.expectedSections.join(', ')}

Research Findings:
${findingsContext}

Write a comprehensive draft report based on these findings.`,
    temperature: generationConfig.temperature,
    abortSignal,
  });

  return {
    content: text,
    iteration: 1,
    informationGaps: [],
    refinementSuggestions: [],
  };
}

/**
 * Phase 5: Analyze draft for gaps and refine
 */
async function refineDraft(
  draft: DraftReport,
  plan: ResearchPlan,
  emit: EventEmitter,
  generationConfig: ResearchGenerationConfig,
  abortSignal?: AbortSignal
): Promise<{ gaps: string[]; searches: string[] }> {
  emitPhaseChange(emit, 'refining', `Refining report (iteration ${draft.iteration})...`);

  // Include temporal context for accurate gap analysis
  const temporalContext = getTemporalContextBlock();
  const systemPrompt = `${temporalContext}\n\n${REPORT_REFINEMENT_PROMPT}`;

  const { text } = await generateText({
    model: generationConfig.model,
    system: systemPrompt,
    prompt: `Original Query: ${plan.originalQuery}
Expected Sections: ${plan.expectedSections.join(', ')}

Draft Report:
${draft.content}

Analyze this draft and identify gaps and areas for improvement.`,
    temperature: generationConfig.temperature,
    abortSignal,
  });

  const { value, debug } = parseJsonResponse<{
    informationGaps: string[];
    suggestedSearches: string[];
  }>(text);
  const analysis = validateRefinementAnalysis(value, debug);

  emit({
    type: 'refinement_update',
    iteration: draft.iteration,
    maxIterations: 3,
    gaps: analysis.informationGaps,
    timestamp: new Date(),
  });

  return {
    gaps: analysis.informationGaps,
    searches: analysis.suggestedSearches,
  };
}

/**
 * Phase 6: Generate final report
 */
async function generateFinalReport(
  draft: DraftReport,
  plan: ResearchPlan,
  findings: ResearchFinding[],
  emit: EventEmitter,
  generationConfig: ResearchGenerationConfig,
  abortSignal?: AbortSignal
): Promise<FinalReport> {
  emitPhaseChange(emit, 'finalizing', 'Generating final report...');

  // Include temporal context for accurate date references in final report
  const temporalContext = getTemporalContextBlock();
  const systemPrompt = `${temporalContext}\n\n${FINAL_REPORT_PROMPT}`;

  // Collect all unique sources
  const allSources = findings.flatMap((f) => f.sources);
  const uniqueSources = allSources.filter(
    (source, index, self) => index === self.findIndex((s) => s.url === source.url)
  );

  const { text } = await generateText({
    model: generationConfig.model,
    system: systemPrompt,
    prompt: `Original Query: ${plan.originalQuery}
Clarified Query: ${plan.clarifiedQuery}

Draft Report:
${draft.content}

Available Sources:
${uniqueSources.map((s) => `- [${s.title}](${s.url})`).join('\n')}

Create the final, polished version of this research report.`,
    temperature: generationConfig.temperature,
    abortSignal,
  });

  // Extract title from the report (first # heading)
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : plan.clarifiedQuery;

  const report: FinalReport = {
    title,
    content: text,
    citations: uniqueSources,
    generatedAt: new Date(),
  };

  emit({
    type: 'final_report',
    report,
    timestamp: new Date(),
  });

  return report;
}

/**
 * Helper to check if research has been aborted
 */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Research cancelled');
  }
}

/**
 * Main orchestration function - runs the complete deep research workflow
 */
export async function runDeepResearch(
  userQuery: string,
  emit: EventEmitter,
  config: Partial<DeepResearchConfig> = {}
): Promise<DeepResearchState> {
  const state = createInitialState(userQuery, config);
  const maxIterations = config.maxIterations ?? 3;
  const abortSignal = config.abortSignal;
  const generationConfig = await resolveResearchGenerationConfig(config);

  try {
    // Check if search is available
    if (!isSearchAvailable()) {
      console.warn('[DEEP-RESEARCH] Search API not configured, using mock data');
    }

    // Phase 1: Planning
    checkAborted(abortSignal);
    state.currentPhase = 'planning';
    state.plan = await planResearch(state, emit, generationConfig, abortSignal);

    // Phase 2: Generate search queries
    checkAborted(abortSignal);
    const searchQueries = await generateSearchQueries(state.plan, emit, generationConfig, abortSignal);
    state.totalSearches = searchQueries.length;

    // Phase 3: Execute searches
    checkAborted(abortSignal);
    state.currentPhase = 'searching';
    state.findings = await executeResearchSearches(searchQueries, emit, config);
    state.completedSearches = state.findings.length;

    // Phase 4: Generate initial draft
    checkAborted(abortSignal);
    state.currentPhase = 'drafting';
    state.draftReport = await generateDraftReport(state.plan, state.findings, emit, generationConfig, abortSignal);

    // Phase 5: Iterative refinement loop
    for (let i = 0; i < maxIterations - 1; i++) {
      checkAborted(abortSignal);
      state.iteration = i + 1;
      state.currentPhase = 'refining';

      const { gaps, searches } = await refineDraft(state.draftReport, state.plan, emit, generationConfig, abortSignal);

      // If no significant gaps, break early
      if (gaps.length === 0 || searches.length === 0) {
        emit({
          type: 'analysis_update',
          message: 'No significant gaps found, proceeding to final report.',
          timestamp: new Date(),
        });
        break;
      }

      // Execute additional searches for gaps
      checkAborted(abortSignal);
      const additionalFindings = await executeResearchSearches(
        searches.slice(0, 5), // Limit additional searches
        emit,
        config
      );
      state.findings.push(...additionalFindings);

      // Regenerate draft with new findings
      checkAborted(abortSignal);
      state.draftReport = await generateDraftReport(state.plan, state.findings, emit, generationConfig, abortSignal);
      state.draftReport.iteration = i + 2;
      state.draftReport.informationGaps = gaps;
    }

    // Phase 6: Generate final report
    checkAborted(abortSignal);
    state.currentPhase = 'finalizing';
    state.finalReport = await generateFinalReport(
      state.draftReport,
      state.plan,
      state.findings,
      emit,
      generationConfig,
      abortSignal
    );

    // Complete
    state.currentPhase = 'complete';
    emit({
      type: 'complete',
      state,
      timestamp: new Date(),
    });

    return state;
  } catch (error) {
    // Don't emit error for cancellation - it's expected behavior
    const isCancelled = error instanceof Error && error.message === 'Research cancelled';

    state.currentPhase = 'error';
    state.error = error instanceof Error ? error.message : 'Unknown error';

    if (!isCancelled) {
      logDeepResearchError(error, state);
      emit(buildDeepResearchErrorEvent(error, state.error));
    }

    throw error;
  }
}

