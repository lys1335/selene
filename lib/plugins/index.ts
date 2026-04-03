/**
 * Plugin System — Public API
 *
 * Re-exports all plugin system modules for convenient imports.
 */

// Types
export type {
  PluginManifest,
  PluginComponents,
  PluginSkillEntry,
  PluginAgentEntry,
  PluginHooksConfig,
  PluginMCPConfig,
  PluginLSPConfig,
  PluginScope,
  PluginStatus,
  InstalledPlugin,
  PluginParseResult,
  HookEventType,
  HookInput,
  HookExecutionResult,
  MarketplaceManifest,
  RegisteredMarketplace,
} from "./types";

// Registry — CRUD
export {
  installPlugin,
  getInstalledPlugins,
  getActivePluginMCPServers,
  updatePluginMCPServerConfig,
  addMarketplace,
  getMarketplaces,
  removeMarketplace,
} from "./registry";

// Import parser
export { parsePluginPackage } from "./import-parser";

// Hooks engine
export {
  registerPluginHooks,
  unregisterPluginHooks,
  clearAllHooks,
  getRegisteredHooks,
  dispatchHook,
  type HookDispatchResult,
} from "./hooks-engine";

// Hook integration (for tool pipeline)
export {
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
  runStopHooks,
} from "./hook-integration";

// MCP integration
export {
  connectPluginMCPServers,
} from "./mcp-integration";

// Skill loader (for system prompt injection)
export {
  getPluginSkillsForPrompt,
  getPluginSkillContent,
  getActivePluginSkills,
} from "./skill-loader";
