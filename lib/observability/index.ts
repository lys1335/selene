/**
 * Observability Module
 * 
 * Provides agent run tracking, event logging, and prompt versioning.
 * 
 * Usage:
 * 
 * ```ts
 * import { 
 *   withRunContext, 
 *   getRunContext, 
 *   createAgentRun, 
 *   appendRunEvent,
 *   getOrCreatePromptVersion 
 * } from "@/lib/observability";
 * 
 * // At pipeline entrypoint:
 * const run = await createAgentRun({ sessionId, pipelineName: "chat" });
 * await withRunContext({ runId: run.id, sessionId, pipelineName: "chat" }, async () => {
 *   // Your pipeline logic here
 *   const ctx = getRunContext()!;
 *   await appendRunEvent({ runId: ctx.runId, eventType: "step_started", stepName: "process" });
 * });
 * await completeAgentRun(run.id, "succeeded");
 * ```
 */

// Run context (AsyncLocalStorage-based)
export {
  withRunContext,
} from "./run-context";

// Database queries
export {
  // Agent runs
  createAgentRun,
  completeAgentRun,
  updateAgentRunMetadata,
  appendRunEvent,
  // Prompt templates & versions
  listPromptVersions,
  listPromptTemplates,
  // Stale run management
  findZombieRuns,
  markRunAsCancelled,
  // Admin/List queries
  type ListAgentRunsOptions,
  listAgentRuns,
  getAgentRunWithEvents,
  // Prompt analytics
  type PromptVersionMetrics,
  getPromptVersionMetrics,
  getVersionAdoptionTimeline,
} from "./queries";

// Tool event handler integration
export {
  initializeToolEventHandler,
} from "./tool-event-handler";

// Cleanup job
export {
  startCleanupJob,
} from "./cleanup-job";
