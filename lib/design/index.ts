/**
 * Selene Design Library -- Public API
 *
 * Consumers should import exclusively from this barrel file:
 *
 * ```ts
 * import { generateCard, editCard } from '@/lib/design';
 * import type { GenerateOpts, EditOpts, StreamEvent } from '@/lib/design';
 * ```
 */

// -- Core pipeline functions ------------------------------------------------
export { generateCard } from './generate';
export { editCard } from './edit';

// -- Library registry -------------------------------------------------------
export {
  DESIGN_LIBRARIES,
  detectAvailableLibraries,
  getAvailableLibrariesPrompt,
} from './libraries';
export type { DesignLibrary } from './libraries';

