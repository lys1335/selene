/**
 * Context Window Management Module
 *
 * Provides comprehensive context window management for multi-provider LLM applications.
 * Includes token tracking, threshold detection, and intelligent message compaction.
 *
 * @module lib/context-window
 * @see docs/CONTEXT_WINDOW_MANAGEMENT_DESIGN.md
 *
 * @example
 * ```typescript
 * import { ContextWindowManager } from "@/lib/context-window";
 *
 * // Pre-flight check before sending request
 * const result = await ContextWindowManager.preFlightCheck(
 *   sessionId,
 *   "claude-sonnet-4-5-20250929",
 *   systemPrompt.length
 * );
 *
 * if (!result.canProceed) {
 *   // Handle blocked request
 *   return new Response(JSON.stringify({
 *     error: result.error,
 *     recovery: result.recovery
 *   }), { status: 413 });
 * }
 *
 * // Proceed with request...
 * ```
 */

// Main orchestrator
export {
  ContextWindowManager,
  type ContextWindowStatus,
} from "./manager";

export {
  isDelegatedToolName,
} from "./claudecode-scope-classifier";
