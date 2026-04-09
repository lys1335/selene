/**
 * Design Library Types
 *
 * Core type definitions for the design generation and editing pipeline.
 * Used by the provider integration, prompt builders, and API routes.
 */

export type StreamEvent =
  | { type: "start"; metadata?: Record<string, unknown> }
  | { type: "delta"; content: string }
  | { type: "complete"; content: string; metadata?: Record<string, unknown> }
  | { type: "error"; error: { code: string; message: string } };

export interface GenerateOpts {
  prompt: string;
  mode: "tailwind";
  style?: "apple-glass" | "default";
  assets?: AssetContext[];
  availableLibrariesBlock?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  onFinish?: (result: FinishResult) => void;
}

export interface EditOpts {
  code: string;
  editPrompt: string;
  selectedComponent?: string;
  style?: "apple-glass" | "default";
  assets?: AssetContext[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  onFinish?: (result: FinishResult) => void;
}

export interface AssetContext {
  id: string;
  url: string;
  alt?: string;
  base64Data?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
}

interface FinishResult {
  success: boolean;
  content?: string;
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
  durationMs: number;
}
