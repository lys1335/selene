/**
 * Agent Memory System
 *
 * A per-agent memory system that extracts important patterns from conversations
 * and builds a living ruleset that's injected into system prompts.
 *
 * @example
 * ```typescript
 * import { AgentMemoryManager, formatMemoriesForPrompt, triggerExtraction } from "@/lib/agent-memory";
 *
 * // Load memories for prompt injection
 * const { markdown, tokenEstimate } = formatMemoriesForPrompt(characterId);
 *
 * // Trigger extraction after chat
 * await triggerExtraction(characterId, sessionId);
 *
 * // Manual memory management
 * const manager = new AgentMemoryManager(characterId);
 * const memories = await manager.loadPendingMemories();
 * await manager.approveMemory(memoryId);
 * ```
 */

// Types
export type {
  MemoryCategory,
} from "./types";

// Memory Manager
export { AgentMemoryManager } from "./memory-manager";

// Prompt Injection
export {
  formatMemoriesForPrompt,
} from "./prompt-injection";

// Extraction
export {
  triggerExtraction,
  manualExtraction,
} from "./extraction";
