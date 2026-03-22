/**
 * Strip common markdown formatting so TTS gets clean plaintext.
 *
 * Handles: fenced code blocks, headers (#), bold/italic (* / ** / _ / __),
 * inline code (`), links [text](url), images ![alt](url), strikethrough (~~),
 * list markers (- / * / 1.), blockquotes (>), horizontal rules, and HTML tags.
 *
 * The function is idempotent — running it on already-stripped text is a no-op.
 */
export function stripMarkdown(text: string): string {
  let out = text;

  // Remove fenced code blocks (```...```) entirely — must come before inline code
  out = out.replace(/```[\s\S]*?```/g, "");

  // Remove images ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Replace links [text](url) with just the text
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove header markers
  out = out.replace(/^#{1,6}\s+/gm, "");

  // Remove blockquote markers
  out = out.replace(/^>\s+/gm, "");

  // Remove horizontal rules (---, ***, ___)
  out = out.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove list markers — must come before bold/italic to avoid * ambiguity
  out = out.replace(/^[-*+]\s+/gm, "");
  out = out.replace(/^\d+\.\s+/gm, "");

  // Remove bold/italic markers with * (order matters: *** before ** before *)
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  out = out.replace(/\*\*(.+?)\*\*/g, "$1");
  out = out.replace(/\*(.+?)\*/g, "$1");

  // Remove bold/italic markers with _ (word-boundary-aware to preserve snake_case)
  out = out.replace(/(?<!\w)___(.+?)___(?!\w)/g, "$1");
  out = out.replace(/(?<!\w)__(.+?)__(?!\w)/g, "$1");
  out = out.replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");

  // Remove inline code backticks
  out = out.replace(/`([^`]*)`/g, "$1");

  // Remove strikethrough
  out = out.replace(/~~(.+?)~~/g, "$1");

  // Remove simple HTML tags
  out = out.replace(/<[^>]+>/g, "");

  // Collapse multiple spaces and excessive newlines
  out = out.replace(/ {2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}
