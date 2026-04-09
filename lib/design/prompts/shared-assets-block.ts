/**
 * Shared asset instruction block for design system prompts.
 *
 * All prompt builders (html-mode, tailwind-mode, edit-full, edit-inline) need
 * to inject the same "USER-PROVIDED ASSETS" preamble when the caller supplies
 * asset context.  The only variance is the example syntax (HTML vs JSX), which
 * is controlled via the `syntax` parameter.
 */

type AssetSyntax = 'html' | 'jsx';

const EXAMPLES: Record<AssetSyntax, string> = {
  html: `(e.g., background-image: url('__ASSET_1__') or <img src="__ASSET_1__">)`,
  jsx: `(e.g., style={{backgroundImage: "url('__ASSET_1__')"}} or <img src="__ASSET_1__" />)`,
};

/**
 * Build the prompt preamble that tells the LLM about user-provided assets.
 *
 * Returns an empty string when `assets` is undefined or empty, so callers
 * can unconditionally interpolate the result into their prompt templates.
 *
 * @param assets  - Pre-formatted asset list (placeholder URLs + descriptions).
 * @param syntax  - Which example syntax to show: `'html'` for HTML mode,
 *                  `'jsx'` for Tailwind / React modes.
 */
export function buildAssetsBlock(
  assets: Array<{ url: string; description?: string }> | undefined,
  syntax: AssetSyntax = 'jsx',
): string {
  if (!assets || assets.length === 0) return '';

  const listing = assets
    .map((a, i) => `Asset ${i + 1}: ${a.url}${a.description ? ` — ${a.description}` : ''}`)
    .join('\n');

  return (
    `USER-PROVIDED ASSETS (reference images are attached for visual context):\n` +
    `${listing}\n` +
    `IMPORTANT: Use the __ASSET_N__ tokens EXACTLY as written in your generated code ` +
    `${EXAMPLES[syntax]}. Do NOT attempt to expand, modify, or replace these tokens — ` +
    `they will be resolved automatically.\n\n`
  );
}
