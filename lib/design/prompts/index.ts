/**
 * Design system prompt builders — re-export barrel.
 *
 * All prompt builders are pure functions that return strings (or { system, user } pairs).
 * They have zero external dependencies and can be used in any runtime.
 */

export { buildAppleGlassPrompt } from './apple-glass';
export { buildHtmlModePrompt } from './html-mode';
export type { HtmlModePromptOptions } from './html-mode';
export { buildTailwindModePrompt } from './tailwind-mode';
export type { TailwindModePromptOptions } from './tailwind-mode';
export { buildAnimationPrompt } from './animation';
export { buildInlineEditPrompt } from './edit-inline';
export type { InlineEditPromptOptions } from './edit-inline';
export { buildFullEditPrompt } from './edit-full';
export type { FullEditPromptOptions } from './edit-full';
