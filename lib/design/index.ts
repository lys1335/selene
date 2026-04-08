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
export { generateDesignText } from './providers';

// -- Types (re-exported for consumer convenience) ---------------------------
export type {
  GenerateOpts,
  EditOpts,
  StreamEvent,
  AssetContext,
  DesignToken,
  FinishResult,
} from './types';
