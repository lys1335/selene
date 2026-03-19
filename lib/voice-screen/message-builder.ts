import type { ScreenCaptureMetadata } from "@/lib/electron/types";

export interface CaptureContext {
  /** Absolute or relative URL of the captured image, e.g. /api/media/screenshots/... */
  imageUrl?: string;
  /** Transcribed text from speech-to-text. */
  transcription?: string;
  /** Metadata describing what was on screen at capture time. */
  metadata?: ScreenCaptureMetadata;
  captureMode: "screen-only" | "voice-only" | "unified";
}

/**
 * Builds the context preamble that is prepended to the user's message text.
 *
 * The preamble gives the AI compact, scannable information about what was on
 * screen when the capture was triggered — app name, window title, and URL if
 * available.
 *
 * Example output:
 *   [Screen Context: Chrome — "Boot.dev Challenge: Arrays in Python" — https://boot.dev/...]
 *
 * When no metadata is available the function returns an empty string so callers
 * don't need to guard against leading newlines.
 */
export function buildContextPreamble(ctx: CaptureContext): string {
  const parts: string[] = [];

  if (ctx.metadata) {
    parts.push(buildScreenContextNote(ctx.metadata));
  }

  if (ctx.transcription) {
    parts.push(`[Voice: ${ctx.transcription.trim()}]`);
  }

  if (parts.length === 0) return "";

  return parts.join("\n");
}

/**
 * Builds a short one-line note about the screen state for use as an agent
 * system note or as an inline context marker.
 *
 * Returns a string like:
 *   [Screen Context: Chrome — "Boot.dev Challenge: Arrays in Python" — https://boot.dev/...]
 *
 * Fields are omitted when not present in `metadata` so the output is always
 * well-formed even with partial data.
 */
/**
 * Sanitize OS-provided strings before embedding them in AI messages.
 * Truncates to maxLen and strips newlines/CR to prevent prompt injection via
 * maliciously crafted window titles or page URLs.
 */
function sanitizeMetadataField(value: string, maxLen: number): string {
  return value
    .replace(/[\r\n\t]/g, " ")  // strip control characters
    .slice(0, maxLen)
    .trim();
}

export function buildScreenContextNote(metadata: ScreenCaptureMetadata): string {
  const tokens: string[] = [];

  if (metadata.activeAppName) {
    tokens.push(sanitizeMetadataField(metadata.activeAppName, 50));
  }

  if (metadata.activeWindowTitle) {
    tokens.push(`"${sanitizeMetadataField(metadata.activeWindowTitle, 100)}"`);
  }

  if (metadata.activeUrl) {
    // URLs get a longer budget but still need newline stripping
    tokens.push(sanitizeMetadataField(metadata.activeUrl, 200));
  }

  if (tokens.length === 0) {
    return "[Screen Context: unknown]";
  }

  return `[Screen Context: ${tokens.join(" — ")}]`;
}
