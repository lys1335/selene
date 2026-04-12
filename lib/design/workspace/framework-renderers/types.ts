/**
 * Framework Renderer Types
 *
 * Defines the interface all framework renderers must implement,
 * plus shared types for rendering context and output.
 */

import type { FrameworkType, DetectedFramework } from "../project-detection";
import type { DesignWorkspaceConfig, DesignWorkspaceCompileReport } from "../config";

export interface RendererContext {
  projectRoot: string;
  worktreePath: string;
  framework: DetectedFramework;
  config: DesignWorkspaceConfig;
}

export interface RendererOutput {
  /** Self-contained HTML (for compile-tier renderers) */
  html?: string;
  /** Proxy URL (for dev-server-tier renderers) */
  proxyUrl?: string;
  /** Compilation diagnostics */
  compileReport?: DesignWorkspaceCompileReport;
  /** Source code that was rendered */
  sourceCode?: string;
}

export type RendererTier = "compile" | "dev-server";

export interface FrameworkRenderer {
  /** The framework(s) this renderer handles */
  readonly frameworks: FrameworkType[];

  /** Whether this renderer runs in-process or needs a subprocess */
  readonly tier: RendererTier;

  /** Initialize renderer for a specific project worktree */
  startup(ctx: RendererContext): Promise<void>;

  /** Render a specific file to preview HTML or URL */
  render(targetFile: string, mode: "page" | "component" | "route"): Promise<RendererOutput>;

  /** Re-render after edit (incremental if possible) */
  rerender(targetFile: string, changedCode: string): Promise<RendererOutput>;

  /** Check if the renderer is initialized and healthy */
  isHealthy(): boolean;

  /** Cleanup resources (kill processes, free ports) */
  shutdown(): Promise<void>;
}
