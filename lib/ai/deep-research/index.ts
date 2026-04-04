/**
 * Deep Research Module
 * 
 * Provides comprehensive research capabilities inspired by ThinkDepth.ai's
 * Deep Research agent. This module enables multi-step research workflows
 * with web search, analysis, and report generation.
 * 
 * Usage:
 * ```typescript
 * import { runDeepResearch } from '@/lib/ai/deep-research';
 * 
 * const state = await runDeepResearch(
 *   "What are the latest developments in quantum computing?",
 *   (event) => console.log(event),
 *   { maxIterations: 3 }
 * );
 * ```
 */

// Export types
export type {
  DeepResearchEvent,
  DeepResearchConfig,
} from './types';

// Export orchestrator functions
export {
  runDeepResearch,
} from './orchestrator';

