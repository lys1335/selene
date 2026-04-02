/**
 * Design Library Types
 *
 * Core type definitions for the design generation and editing pipeline.
 * Used by the provider integration, prompt builders, and API routes.
 */

// -- Stream events for the generate/edit pipeline --------------------------

export type StreamEventType = "start" | "delta" | "complete" | "error";

export interface StreamEvent {
  type: StreamEventType;
  /** Partial or full content depending on event type */
  content?: string;
  /** Arbitrary metadata attached to the event (e.g. token counts, model info) */
  metadata?: Record<string, unknown>;
  /** Present only on error events */
  error?: { code: string; message: string };
}

// -- Generation options ----------------------------------------------------

export interface GenerateOpts {
  prompt: string;
  mode: "html" | "tailwind";
  style?: "apple-glass" | "default";
  assets?: AssetContext[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** AbortSignal for cancelling the generation mid-stream */
  abortSignal?: AbortSignal;
  /** Called when generation completes (success or error) with final metadata */
  onFinish?: (result: FinishResult) => void;
}

// -- Edit options ----------------------------------------------------------

export interface EditOpts {
  /** The existing code to modify */
  code: string;
  /** Natural-language instruction describing the desired edit */
  editPrompt: string;
  /** Optional CSS selector or component name to scope the edit */
  selectedComponent?: string;
  /** When true, edits should be applied inline rather than rewriting the full block */
  inlineMode?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** AbortSignal for cancelling the edit mid-stream */
  abortSignal?: AbortSignal;
  /** Called when edit completes (success or error) with final metadata */
  onFinish?: (result: FinishResult) => void;
}

// -- Asset context for prompt injection ------------------------------------

export interface AssetContext {
  id: string;
  url: string;
  alt?: string;
  metadata?: Record<string, unknown>;
}

// -- Design tokens ---------------------------------------------------------

export type DesignTokenCategory =
  | "color"
  | "spacing"
  | "shadow"
  | "animation"
  | "typography"
  | "border";

// -- Finish result for observability callbacks --------------------------------

export interface FinishResult {
  /** Whether the generation succeeded */
  success: boolean;
  /** Final content (on success) */
  content?: string;
  /** Error details (on failure) */
  error?: { code: string; message: string };
  /** Provider/model metadata */
  metadata?: Record<string, unknown>;
  /** Total duration in milliseconds */
  durationMs: number;
}

// -- Design tokens ---------------------------------------------------------

export interface DesignToken {
  name: string;
  value: string | number | Record<string, unknown>;
  category: DesignTokenCategory;
  description?: string;
}
