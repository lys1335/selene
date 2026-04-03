/**
 * Tool Registry Type Definitions
 *
 * Based on Anthropic's Advanced Tool Use patterns (Nov 2025):
 * - Tool Search Tool: On-demand tool discovery with deferred loading
 * - Tool categorization for better searchability
 * - Metadata for tool management
 */

import type { Tool } from "ai";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tool category for grouping and search
 */
export type ToolCategory =
  | "image-generation"
  | "image-editing"
  | "video-generation"
  | "analysis"
  | "knowledge"
  | "utility"
  | "search"
  | "scheduling"
  | "mcp"
  | "custom-comfyui"
  | "browser"
  | "computer-use";

/**
 * Configuration for when a tool should be loaded
 */
interface ToolLoadingConfig {
  /**
   * If true, this tool is excluded from the initial context and only
   * loaded when discovered via the tool search tool.
   * Default: false (always loaded)
   */
  deferLoading?: boolean;

  /**
   * If true, this tool is always included in the context regardless
   * of other settings. Used for core/essential tools.
   * Default: false
   */
  alwaysLoad?: boolean;
}

/**
 * Metadata for a registered tool
 */
export interface ToolMetadata {
  /** Human-readable display name */
  displayName: string;

  /** Tool category for grouping */
  category: ToolCategory;

  /** Keywords for search matching */
  keywords: string[];

  /** Brief description for search results (max 100 chars) */
  shortDescription: string;

  /**
   * Full usage instructions returned by searchTools.
   * Contains detailed parameter docs, usage examples, and guidelines.
   * This replaces verbose tool descriptions and system prompt instructions.
   */
  fullInstructions?: string;

  /** Loading configuration */
  loading: ToolLoadingConfig;

  /** Whether this tool requires a session ID */
  requiresSession: boolean;

  /** Environment variable that enables/disables this tool */
  enableEnvVar?: string;

  /**
   * If true, tool results are shown in UI but excluded from AI conversation history.
   * Used to save tokens for large outputs like browser snapshots that the AI has
   * already processed in the current turn.
   */
  ephemeralResults?: boolean;

  /**
   * Optional MCP annotations forwarded when this tool is exposed through the
   * Claude Agent SDK bridge.
   */
  mcpAnnotations?: ToolAnnotations;
}

/**
 * Options passed to tool factory functions
 */
interface ToolFactoryOptions {
  /** Session ID for database tracking */
  sessionId?: string;

  /** User ID for authorization and ownership */
  userId?: string;

  /** Character ID for agent-specific context */
  characterId?: string;

  /** Character avatar URL for character-aware tools */
  characterAvatarUrl?: string;

  /** Character appearance description */
  characterAppearanceDescription?: string;

  /** Live executeCommand progress hook forwarded by request-scoped runtimes. */
  onExecuteCommandProgress?: import("@/lib/command-execution/types").ExecuteCommandProgressUpdate extends infer T
    ? (update: T) => void
    : never;

  /** LLM provider name — forwarded to tools that need execution-strategy awareness. */
  provider?: string;
}

/**
 * Factory function type for creating tools
 */
export type ToolFactory = (options: ToolFactoryOptions) => Tool;

/**
 * A registered tool definition
 */
export interface RegisteredTool {
  /** Unique tool name/identifier */
  name: string;

  /** Tool metadata for search and management */
  metadata: ToolMetadata;

  /** Factory function to create the tool instance */
  factory: ToolFactory;
}

/**
 * Context for tool instantiation
 */
export interface ToolContext {
  /** Current session ID */
  sessionId: string;

  /** User ID for authorization */
  userId?: string;

  /** Character ID for agent-specific context */
  characterId?: string;

  /** Character context (optional) */
  characterAvatarUrl?: string;
  characterAppearanceDescription?: string;

  /** Live executeCommand progress hook forwarded by request-scoped runtimes. */
  onExecuteCommandProgress?: (update: import("@/lib/command-execution/types").ExecuteCommandProgressUpdate) => void;

  /** Which tools to include (overrides deferred loading) */
  includeTools?: string[];

  /** Whether to include deferred tools */
  includeDeferredTools?: boolean;

  /**
   * Agent-specific enabled tools filter.
   * If provided, ONLY tools in this set (plus alwaysLoad tools) will be loaded.
   * This enforces per-agent tool restrictions selected via the UI.
   */
  agentEnabledTools?: Set<string>;

  /** LLM provider name — used by delegation tools to decide execution strategy. */
  provider?: string;
}

/**
 * Search result from the tool search tool
 */
export interface ToolSearchResult {
  /** Tool name */
  name: string;

  /** Display name */
  displayName: string;

  /** Category */
  category: ToolCategory;

  /** Short description */
  description: string;

  /** Match score (0-1) */
  relevance: number;

  /** Full usage instructions (detailed parameters, examples, guidelines) */
  fullInstructions?: string;
}

/**
 * Context for tool search/discovery. Extracted here (rather than in search-tool.ts)
 * to avoid a circular dependency: selene-sdk-mcp-server → search-tool → providers.
 */
export interface ToolSearchContext {
  /**
   * Set of tool names that are initially active (non-deferred tools).
   * These tools are available for immediate use.
   */
  initialActiveTools?: Set<string>;

  /**
   * Mutable set of tool names that have been discovered via searchTools.
   * When searchTools finds a deferred tool, it adds the tool name here.
   * The prepareStep callback reads this to dynamically enable discovered tools.
   */
  discoveredTools?: Set<string>;

  /**
   * Enables Anthropic tool-reference output bridging for deferred tools.
   * When enabled, searchTools emits tool_reference blocks via toModelOutput
   * so Anthropic can load deferred schemas server-side.
   */
  enableAnthropicToolReferences?: boolean;

  /**
   * Set of tool names that are enabled for this specific agent/character.
   * If provided, search results are filtered to only show tools in this set
   * (plus tools with alwaysLoad: true like searchTools/listAllTools).
   * If undefined, all enabled tools are shown (for agents without tool restrictions).
   */
  enabledTools?: Set<string>;

  /**
   * @deprecated Use initialActiveTools instead
   * Set of tool names that are actually loaded in the current session.
   * If provided, only these tools will be reported as available.
   * If undefined, all enabled tools are shown (legacy behavior).
   */
  loadedTools?: Set<string>;

  /**
   * Workflow subagent directory for subagent discovery.
   * When provided, searchTools will also search available subagents
   * by matching query against subagent names and purposes.
   * Format: ["- AgentName (id: agent-id): Purpose description", ...]
   */
  subagentDirectory?: string[];
}

