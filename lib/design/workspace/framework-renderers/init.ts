/**
 * Framework Renderer Initialization
 *
 * Registers all available framework renderers with the global registry.
 * Call this once during design workspace tool initialization.
 */

import { rendererRegistry } from "./registry";
import { ReactRenderer } from "./react-renderer";
import { NextjsRenderer } from "./nextjs-renderer";
import { StaticRenderer } from "./static-renderer";
import { ViteRenderer } from "./vite-renderer";
import { PHPRenderer } from "./php-renderer";

let initialized = false;

/** Register all framework renderers. Safe to call multiple times. */
export function initializeRenderers(): void {
  if (initialized) return;

  rendererRegistry.register(new ReactRenderer());
  rendererRegistry.register(new NextjsRenderer());
  rendererRegistry.register(new StaticRenderer());
  rendererRegistry.register(new ViteRenderer());
  rendererRegistry.register(new PHPRenderer());

  initialized = true;
}
