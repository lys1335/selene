/**
 * Framework Renderer Registry
 *
 * Maps framework types to renderer instances. Ensures only one renderer
 * per framework is active at a time, and provides lifecycle management.
 */

import type { FrameworkType } from "../project-detection";
import type { FrameworkRenderer, RendererContext } from "./types";

/** Factory that creates a fresh renderer instance */
type RendererFactory = () => FrameworkRenderer;

class RendererRegistry {
  private factories = new Map<FrameworkType, RendererFactory>();
  private activeRenderers = new Map<string, FrameworkRenderer>(); // keyed by worktreePath

  /** Register a renderer for its declared frameworks.
   *  Stores a factory so each worktree gets its own instance. */
  register(renderer: FrameworkRenderer): void {
    const Ctor = renderer.constructor as new () => FrameworkRenderer;
    for (const framework of renderer.frameworks) {
      this.factories.set(framework, () => new Ctor());
    }
  }

  /** Get a prototype renderer for a framework (for metadata/tier inspection, not started) */
  getRenderer(framework: FrameworkType): FrameworkRenderer | null {
    const factory = this.factories.get(framework);
    return factory ? factory() : null;
  }

  /** Get or start a renderer for a specific worktree context */
  async getOrStartRenderer(ctx: RendererContext): Promise<FrameworkRenderer | null> {
    const key = ctx.worktreePath;
    const existing = this.activeRenderers.get(key);
    if (existing && existing.isHealthy()) {
      return existing;
    }

    const factory = this.factories.get(ctx.framework.type);
    if (!factory) {
      return null;
    }

    // Create a fresh instance for this worktree
    const renderer = factory();

    // Enforce rendererTier config — reject dev-server renderers when compile-only
    if (ctx.config.rendererTier === "compile-only" && renderer.tier === "dev-server") {
      return null;
    }

    // Enforce maxDevServers limit
    if (renderer.tier === "dev-server" && this.activeDevServerCount() >= ctx.config.maxDevServers) {
      throw new Error(
        `Maximum dev-server limit reached (${ctx.config.maxDevServers}). ` +
        `Shut down an existing renderer before starting a new one.`
      );
    }

    // If there's a stale renderer for this worktree, shut it down
    if (existing) {
      try { await existing.shutdown(); } catch { /* ignore shutdown errors */ }
      this.activeRenderers.delete(key);
    }

    await renderer.startup(ctx);
    this.activeRenderers.set(key, renderer);
    return renderer;
  }

  /** Shut down renderer for a specific worktree */
  async shutdownRenderer(worktreePath: string): Promise<void> {
    const renderer = this.activeRenderers.get(worktreePath);
    if (renderer) {
      try { await renderer.shutdown(); } catch { /* ignore */ }
      this.activeRenderers.delete(worktreePath);
    }
  }

  /** Shut down all active renderers */
  async shutdownAll(): Promise<void> {
    const shutdowns = Array.from(this.activeRenderers.entries()).map(
      async ([key, renderer]) => {
        try { await renderer.shutdown(); } catch { /* ignore */ }
        this.activeRenderers.delete(key);
      }
    );
    await Promise.allSettled(shutdowns);
  }

  /** List all active renderer worktree paths */
  listActive(): string[] {
    return Array.from(this.activeRenderers.keys());
  }

  /** Get the active renderer for a worktree (for metadata inspection) */
  getActiveRenderer(worktreePath: string): FrameworkRenderer | null {
    return this.activeRenderers.get(worktreePath) ?? null;
  }

  /** Check how many dev-server renderers are active */
  activeDevServerCount(): number {
    let count = 0;
    for (const renderer of this.activeRenderers.values()) {
      if (renderer.tier === "dev-server") count++;
    }
    return count;
  }
}

// Singleton registry stored in globalThis for Next.js hot-reload safety
const GLOBAL_KEY = "__selene_renderer_registry__" as const;

function getGlobalRegistry(): RendererRegistry {
  const g = globalThis as unknown as Record<string, RendererRegistry | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new RendererRegistry();
  }
  return g[GLOBAL_KEY]!;
}

export const rendererRegistry = getGlobalRegistry();
