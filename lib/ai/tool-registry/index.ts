/**
 * Tool Registry Module
 *
 * Provides centralized tool management with support for:
 * - Tool Search Tool pattern (Anthropic's Advanced Tool Use)
 * - Deferred loading for context optimization
 * - Tool categorization and discovery
 * - Standardized result types
 * - Retry logic for transient errors
 * - Structured logging
 */

// Core registry
export { ToolRegistry } from "./registry";
export { createToolSearchTool, createListToolsTool, type ToolSearchContext } from "./search-tool";
export { registerAllTools } from "./tool-definitions";

// Logging utilities
export {
  logToolEvent,
} from "./logging";
