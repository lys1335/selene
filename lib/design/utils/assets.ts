/**
 * Asset placeholder utilities for the design pipeline.
 *
 * Both the generation and editing pipelines need to:
 * 1. Convert user-provided assets into `__ASSET_N__` placeholder tokens
 *    (so the LLM never sees raw URLs / base64 data).
 * 2. Substitute placeholders back to real URLs after generation.
 * 3. Sanitize any raw filesystem media paths that leaked into the output.
 *
 * All functions are pure -- no side effects, no external dependencies.
 */

import type { AssetContext } from '../types';

// ---------------------------------------------------------------------------
// Build placeholder-based asset references for prompts
// ---------------------------------------------------------------------------

/**
 * Build prompt-safe asset references using `__ASSET_N__` placeholders instead
 * of raw URLs.  The inner design LLM sees (and copies) only the short token;
 * we substitute it with the real URL after generation.  This prevents the LLM
 * from trying to reproduce data-URI base64 strings in its output.
 */
export function buildAssetPlaceholders(assets: AssetContext[] | undefined): {
  promptAssets: Array<{ url: string; description?: string }> | undefined;
  /** placeholder -> real URL */
  assetMap: Map<string, string>;
} {
  const assetMap = new Map<string, string>();
  if (!assets || assets.length === 0) return { promptAssets: undefined, assetMap };

  const promptAssets = assets.map((a, i) => {
    const placeholder = `__ASSET_${i + 1}__`;
    assetMap.set(placeholder, a.url);
    return {
      url: placeholder,
      description: a.metadata?.description
        ? String(a.metadata.description)
        : a.alt ?? undefined,
    };
  });

  return { promptAssets, assetMap };
}

// ---------------------------------------------------------------------------
// Substitute placeholders back to real URLs
// ---------------------------------------------------------------------------

/** Replace `__ASSET_N__` tokens in generated code with real URLs. */
export function substituteAssetPlaceholders(code: string, assetMap: Map<string, string>): string {
  let result = code;
  for (const [placeholder, url] of assetMap) {
    result = result.replaceAll(placeholder, url);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sanitize raw filesystem media paths
// ---------------------------------------------------------------------------

/**
 * Convert raw filesystem media paths in generated code to `/api/media/` URLs.
 * Catches paths the outer agent embeds directly in the prompt text, bypassing
 * the asset placeholder pipeline. Matches patterns like:
 *   /Users/.../media/sessionId/role/file.png
 *   /home/.../media/sessionId/role/file.png
 *   .local-data/media/sessionId/role/file.png
 */
export function sanitizeMediaPaths(code: string): string {
  // Match absolute or relative paths containing /media/ followed by path segments ending in an image extension
  return code.replace(
    /(?:\/[^\s'"()]+|\.local-data)\/media\/([\w-]+\/[\w-]+\/[^\s'"()]+\.(?:png|jpe?g|gif|webp|svg))/gi,
    '/api/media/$1',
  );
}
