/**
 * Ghost OS Integration — Public API
 *
 * Exposes Ghost OS setup, configuration, and concurrency utilities
 * for use by MCP infrastructure, settings UI, and agent runtime.
 */

// Types
export type {
  GhostOsStatus,
  GhostOsMCPConfig,
  GhostOsActiveOperation,
  GhostDoctorResult,
} from "./types";

// Setup & detection
export {
  resolveGhostBinary,
  getGhostVersion,
  isVisionModelInstalled,
  getGhostOsStatus,
  runGhostDoctor,
  runGhostSetup,
} from "./setup";

// MCP config
export {
  generateGhostOsMCPConfig,
  getGhostOsServerConfig,
  clearGhostOsConfigCache,
  GHOST_OS_SERVER_NAME,
  isGhostOsTool,
  isGhostOsActionTool,
} from "./config";

// Multi-agent concurrency
export {
  getActiveGhostOsOperation,
  setActiveGhostOsOperation,
  clearActiveGhostOsOperation,
  checkGhostOsConcurrency,
  wrapGhostOsExecution,
} from "./concurrency";

// Vision sidecar management
export {
  isVisionSidecarTool,
  ensureVisionSidecar,
} from "./vision-sidecar";

// Recipe bridge (Phase 2 stub)
export type { GhostOsRecipe } from "./recipe-bridge";
export { listRecipes, registerRecipeAsSkill } from "./recipe-bridge";
