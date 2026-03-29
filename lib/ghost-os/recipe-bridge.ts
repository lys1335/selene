/**
 * Ghost OS Recipe ↔ Selene Skill Bridge (Phase 2 stub)
 *
 * This module will bridge Ghost OS recipes (JSON files on disk)
 * with Selene's skill system for per-agent visibility and discovery.
 *
 * Phase 1: Exported types and placeholder functions only.
 * Phase 2: Full implementation with skill table integration.
 */

/**
 * Recipe metadata from Ghost OS
 */
export interface GhostOsRecipe {
  /** Recipe name (used as identifier) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Parameter schema for recipe execution */
  parameters?: Record<string, unknown>;
  /** Source agent that created this recipe */
  sourceAgentName?: string;
}

/**
 * List available Ghost OS recipes.
 * Phase 2: Will query Ghost OS via MCP and merge with Selene skill entries.
 */
export async function listRecipes(): Promise<GhostOsRecipe[]> {
  // Phase 2 implementation
  return [];
}

/**
 * Register a Ghost OS recipe as a Selene skill for a specific agent.
 * Phase 2: Will create a skill table entry with characterId FK.
 */
export async function registerRecipeAsSkill(
  _recipe: GhostOsRecipe,
  _characterId: string,
): Promise<void> {
  // Phase 2 implementation
}
