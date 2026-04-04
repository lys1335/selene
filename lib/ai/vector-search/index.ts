/**
 * Vector Search Module
 *
 * LLM-powered semantic search over indexed codebase folders.
 * Uses a secondary LLM to synthesize and explain search results.
 *
 * Architecture:
 * - session-store.ts: Per-character session management with search history
 * - synthesizer.ts: Secondary LLM for intelligent result synthesis
 * - tool.ts: AI tool implementation
 * - types.ts: Type definitions
 */

// Types
export type {
  SearchFinding,
  VectorSearchResult,
} from "./types";

// Tool factory
export { createVectorSearchToolV2 } from "./tool";
