import type { ToolDependency } from "./tool-catalog";

/**
 * Shared dependency status type used by both the character creation wizard
 * and the character picker tool editor.
 */
export type DependencyStatus = Record<ToolDependency, boolean> & {
  screenCaptureEnabled: boolean;
};

export const DEFAULT_DEPENDENCY_STATUS: DependencyStatus = {
  syncedFolders: false,
  embeddings: false,
  vectorDbEnabled: false,
  webScraper: false,
  openrouterKey: false,
  comfyuiEnabled: false,
  localGrepEnabled: true,
  devWorkspaceEnabled: false,
  screenCaptureEnabled: true,
  runwayApiSecret: false,
  vertexAIProjectId: false,
};

type HasDependencies = { dependencies?: ToolDependency[] };

/**
 * Returns true if all of a tool's declared dependencies are satisfied by the
 * provided status map.
 */
export function areDependenciesMet(
  tool: HasDependencies,
  dependencyStatus: DependencyStatus
): boolean {
  if (!tool.dependencies || tool.dependencies.length === 0) return true;
  return tool.dependencies.every((dep) => dependencyStatus[dep]);
}

/**
 * Returns a human-readable warning string when any declared dependency is
 * unmet, using the provided tDeps translation function.
 */
export function getDependencyWarning(
  tool: HasDependencies,
  dependencyStatus: DependencyStatus,
  tDeps: (key: string) => string
): string | null {
  if (!tool.dependencies || tool.dependencies.length === 0) return null;
  const unmet = tool.dependencies.filter((dep) => !dependencyStatus[dep]);
  if (unmet.length === 0) return null;
  if (unmet.length === 2 && unmet.includes("syncedFolders") && unmet.includes("embeddings")) {
    return tDeps("both");
  }
  return unmet.map((dep) => tDeps(dep)).join(" + ");
}
