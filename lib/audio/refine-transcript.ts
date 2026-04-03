/**
 * Shared transcript refinement helper.
 *
 * Extracts the voice post-processing (grammar cleanup) path used by the
 * main composer so both the main composer and the mini-overlay pipeline
 * can reuse the same refinement logic without duplication.
 */

import {
  finalizeTranscriptText,
  normalizeTranscriptText,
} from "@/components/assistant-ui/voice-transcript-utils";

interface RefineTranscriptOptions {
  /** Raw transcript from STT. */
  rawTranscript: string;
  /** Whether voice post-processing (grammar cleanup) is enabled. */
  postProcessingEnabled: boolean;
  /** Optional AbortSignal to cancel the in-flight refinement request. */
  signal?: AbortSignal;
  /** Optional callback when refinement fails and raw text is used instead. */
  onFailure?: () => void;
}

interface RefineTranscriptResult {
  /** The original raw transcript, trimmed. */
  rawText: string;
  /** The final text to use — enhanced if post-processing succeeded, raw otherwise. */
  finalText: string;
  /** Whether AI enhancement was actually applied. */
  wasEnhanced: boolean;
}

/**
 * Refine a raw transcript using the same grammar-cleanup API that the
 * main composer path uses (`/api/voice/actions` with action `fix-grammar`).
 *
 * - When `postProcessingEnabled` is false, returns the raw transcript immediately.
 * - When the API call fails or returns empty, gracefully falls back to raw text.
 */
export async function refineTranscript(
  options: RefineTranscriptOptions,
): Promise<RefineTranscriptResult> {
  const { rawTranscript, postProcessingEnabled, signal, onFailure } = options;
  const normalized = normalizeTranscriptText(rawTranscript);

  if (!postProcessingEnabled || normalized.length === 0) {
    return { rawText: normalized, finalText: normalized, wasEnhanced: false };
  }

  let enhancedText: string | null = null;
  try {
    const res = await fetch("/api/voice/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: normalized, action: "fix-grammar" }),
      signal,
    });
    const data = (await res.json()) as {
      success?: boolean;
      text?: string;
    };
    if (
      data.success &&
      typeof data.text === "string" &&
      data.text.trim().length > 0
    ) {
      enhancedText = data.text.trim();
    }
  } catch {
    // Refinement failed (network error, aborted, etc.) — fall back to raw text.
    onFailure?.();
  }

  const result = finalizeTranscriptText({
    transcript: normalized,
    postProcessingEnabled: true,
    enhancedText,
  });

  return {
    rawText: result.transcript,
    finalText: result.finalText,
    wasEnhanced: result.usedEnhancedText,
  };
}
