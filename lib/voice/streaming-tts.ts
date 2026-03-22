/**
 * Streaming TTS pipeline: splits streaming text into sentences,
 * then synthesizes and plays them sequentially with prefetching.
 */

import { stripMarkdown } from "@/lib/utils/strip-markdown";
export { stripMarkdown };

// ---------------------------------------------------------------------------
// StableStreamingLifecycle
// ---------------------------------------------------------------------------

export interface StableStreamingLifecycleOptions {
  onStart: () => void;
  onStableEnd: () => void;
  settleDelayMs?: number;
}

/**
 * Shields the streaming TTS pipeline from brief run-state flickers caused by
 * rapid tool-call sequencing. A run only truly ends after it stays idle for
 * the settle window, so mid-sentence playback is not cut off between tool steps.
 */
export class StableStreamingLifecycle {
  private wasRunning = false;
  private active = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onStart: () => void;
  private readonly onStableEnd: () => void;
  private readonly settleDelayMs: number;

  constructor({ onStart, onStableEnd, settleDelayMs = 750 }: StableStreamingLifecycleOptions) {
    this.onStart = onStart;
    this.onStableEnd = onStableEnd;
    this.settleDelayMs = settleDelayMs;
  }

  update(isRunning: boolean): void {
    if (isRunning) {
      this.clearSettleTimer();
      if (!this.active) {
        this.active = true;
        this.onStart();
      }
      this.wasRunning = true;
      return;
    }

    if (this.wasRunning && this.active && !this.settleTimer) {
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        if (!this.active) {
          return;
        }
        this.active = false;
        this.onStableEnd();
      }, this.settleDelayMs);
    }

    this.wasRunning = false;
  }

  cancel(): void {
    this.clearSettleTimer();
    this.wasRunning = false;
    this.active = false;
  }

  private clearSettleTimer(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// SentenceSplitter
// ---------------------------------------------------------------------------

/**
 * Buffers streaming text tokens and emits complete sentences for TTS synthesis.
 * Skips code block content by default. When `readCodeBlocks` is true, code
 * block content is emitted with a "Code:" prefix instead of being discarded.
 */
export class SentenceSplitter {
  private buffer = "";
  private pendingProse = "";
  private inCodeBlock = false;
  private codeBlockContent = "";
  private onSentence: (sentence: string) => void;
  private readCodeBlocks: boolean;

  constructor(onSentence: (sentence: string) => void, options?: { readCodeBlocks?: boolean }) {
    this.onSentence = onSentence;
    this.readCodeBlocks = options?.readCodeBlocks ?? false;
  }

  /** Feed a text delta (streaming token). */
  feed(delta: string): void {
    this.buffer += delta;
    this.drain();
  }

  /** Flush remaining buffer as final sentence. */
  flush(): void {
    // If we're stuck inside a code block at the end
    if (this.inCodeBlock) {
      if (this.readCodeBlocks) {
        // Emit any pending prose before the code block
        const prose = stripMarkdown(this.pendingProse.trim());
        if (prose.length > 0) this.onSentence(prose);
        // Emit accumulated code block content
        const code = (this.codeBlockContent + this.buffer).trim();
        if (code.length > 0) this.onSentence("Code: " + code);
      } else {
        // Emit prose that preceded the unclosed code block
        const prose = stripMarkdown(this.pendingProse.trim());
        if (prose.length > 0) this.onSentence(prose);
      }
      this.buffer = "";
      this.pendingProse = "";
      this.codeBlockContent = "";
      this.inCodeBlock = false;
      return;
    }

    const text = stripMarkdown((this.pendingProse + this.buffer).trim());
    this.buffer = "";
    this.pendingProse = "";

    if (text.length > 0) {
      this.onSentence(text);
    }
  }

  /** Reset state for reuse. */
  reset(): void {
    this.buffer = "";
    this.pendingProse = "";
    this.codeBlockContent = "";
    this.inCodeBlock = false;
  }

  // ---- internal ----------------------------------------------------------

  private drain(): void {
    // Process the buffer in a loop — a single feed() can contain multiple
    // sentences or code-fence transitions.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.inCodeBlock) {
        // Look for closing fence
        const closeIdx = this.buffer.indexOf("```");
        if (closeIdx === -1) {
          if (this.readCodeBlocks) {
            // Accumulate code content for later emission
            this.codeBlockContent += this.buffer;
            this.buffer = "";
          }
          // Still inside code block — wait for closing fence
          break;
        }

        if (this.readCodeBlocks) {
          // Emit pending prose, then code block content
          const prose = stripMarkdown(this.pendingProse.trim());
          if (prose.length > 0) this.onSentence(prose);
          const code = (this.codeBlockContent + this.buffer.slice(0, closeIdx)).trim();
          if (code.length > 0) this.onSentence("Code: " + code);
          this.codeBlockContent = "";
          this.pendingProse = "";
          this.buffer = this.buffer.slice(closeIdx + 3);
        } else {
          // Skip past the closing fence and restore any prose we buffered
          // before the code block opened.
          this.buffer = this.pendingProse + this.buffer.slice(closeIdx + 3);
          this.pendingProse = "";
        }
        this.inCodeBlock = false;
        continue;
      }

      // Check for opening code fence
      const openIdx = this.buffer.indexOf("```");
      if (openIdx !== -1) {
        // Emit everything before the code fence as potential sentences.
        // Any leftover prose stays outside the fenced block so it can resume
        // after the closing fence instead of being swallowed as code.
        const before = this.buffer.slice(0, openIdx);
        const afterFence = this.buffer.slice(openIdx + 3);
        const { remaining } = this.extractFromText(before);
        this.pendingProse = remaining;
        this.codeBlockContent = "";
        // Strip optional language identifier on the opening fence line
        const nlIdx = afterFence.indexOf("\n");
        this.buffer = nlIdx !== -1 ? afterFence.slice(nlIdx + 1) : afterFence;
        this.inCodeBlock = true;
        continue;
      }

      // No code fences in buffer — try to extract sentences
      if (!this.emitSentences(null)) {
        break;
      }
    }
  }

  /**
   * Attempt to emit complete sentences.
   *
   * If `text` is provided, process that text (and prepend any remainder back
   * to this.buffer). If `text` is null, work on this.buffer directly.
   *
   * Returns true if at least one extraction happened (caller may loop).
   */
  private emitSentences(text: string | null): boolean {
    if (text !== null) {
      const { emitted, remaining } = this.extractFromText(text);
      if (remaining.length > 0) {
        this.buffer = remaining + this.buffer;
      }
      return emitted;
    }
    return this.extractFromBuffer();
  }

  private extractFromText(text: string): { emitted: boolean; remaining: string } {
    let emitted = false;
    let remaining = text;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const splitIdx = findSentenceEnd(remaining);
      if (splitIdx === -1) break;

      const raw = remaining.slice(0, splitIdx).trim();
      remaining = remaining.slice(splitIdx).replace(/^[\s]/, ""); // trim leading whitespace after split

      if (raw.length > 0) {
        const clean = stripMarkdown(raw);
        if (clean.length > 0) {
          this.onSentence(clean);
          emitted = true;
        }
      }
    }

    return { emitted, remaining };
  }

  private extractFromBuffer(): boolean {
    let emitted = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const splitIdx = findSentenceEnd(this.buffer);
      if (splitIdx === -1) break;

      const raw = this.buffer.slice(0, splitIdx).trim();
      this.buffer = this.buffer.slice(splitIdx).replace(/^[\s]/, "");

      if (raw.length > 0) {
        const clean = stripMarkdown(raw);
        if (clean.length >= MIN_SENTENCE_LENGTH) {
          this.onSentence(clean);
          emitted = true;
        } else if (clean.length > 0) {
          // Too short — put it back and wait for more
          this.buffer = raw + " " + this.buffer;
          break;
        }
      }
    }

    return emitted;
  }
}

// Minimum chars before we emit a sentence (except on flush)
const MIN_SENTENCE_LENGTH = 20;

/**
 * Find the index *after* a sentence-ending punctuation mark followed by a
 * space, newline, or occurring at the very end of the text.
 *
 * Also splits on double newline.
 *
 * Returns -1 if no split point found.
 */
function findSentenceEnd(text: string): number {
  // Double newline is always a split point
  const doubleNl = text.indexOf("\n\n");

  let punctIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const next = text[i + 1];
      if (next === undefined || next === " " || next === "\n" || next === "\r") {
        // candidate — but enforce min length
        const candidate = i + 1;
        if (candidate >= MIN_SENTENCE_LENGTH) {
          punctIdx = candidate;
          break;
        }
      }
    }
  }

  // Pick whichever comes first (if both exist)
  if (doubleNl !== -1 && (punctIdx === -1 || doubleNl < punctIdx)) {
    return doubleNl > 0 ? doubleNl : -1;
  }

  return punctIdx;
}



// ---------------------------------------------------------------------------
// StreamingTTSQueue
// ---------------------------------------------------------------------------

/**
 * Manages sequential TTS synthesis and playback with prefetching.
 * Sentences are synthesized via POST /api/voice/speak and played back
 * sequentially through the provided onAudio callback.
 */
export class StreamingTTSQueue {
  private queue: string[] = [];
  private isProcessing = false;
  private generation = 0;
  private prefetchCache = new Map<string, Promise<Blob>>();
  private blobUrls = new Set<string>();
  private onAudio: (blobUrl: string) => Promise<void>;

  constructor(onAudio: (blobUrl: string) => Promise<void>) {
    this.onAudio = onAudio;
  }

  /** Enqueue a sentence for synthesis + playback. */
  enqueue(text: string): void {
    this.queue.push(text);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /** Cancel all pending and current playback. */
  cancel(): void {
    this.generation += 1;
    this.queue = [];
    this.prefetchCache.clear();
    this.revokeBlobUrls();
  }

  /** Reset for reuse. */
  reset(): void {
    this.cancel();
  }

  // ---- internal ----------------------------------------------------------

  private async synthesize(text: string): Promise<Blob> {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    return res.blob();
  }

  private getSynthPromise(text: string): Promise<Blob> {
    const cached = this.prefetchCache.get(text);
    if (cached) {
      this.prefetchCache.delete(text);
      return cached;
    }
    return this.synthesize(text);
  }

  private prefetch(text: string): void {
    if (!this.prefetchCache.has(text)) {
      this.prefetchCache.set(text, this.synthesize(text));
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    const generation = this.generation;

    while (this.queue.length > 0 && generation === this.generation) {
      const text = this.queue.shift()!;

      // Prefetch next sentence while we play the current one
      if (this.queue.length > 0) {
        this.prefetch(this.queue[0]);
      }

      try {
        const blob = await this.getSynthPromise(text);

        if (generation !== this.generation) break;

        const blobUrl = URL.createObjectURL(blob);
        this.blobUrls.add(blobUrl);

        try {
          await this.onAudio(blobUrl);
        } catch (err) {
          console.warn("[StreamingTTS] onAudio callback failed:", err);
          // Continue to next sentence — don't halt the queue
        }

        if (this.blobUrls.has(blobUrl)) {
          URL.revokeObjectURL(blobUrl);
          this.blobUrls.delete(blobUrl);
        }
      } catch (err) {
        if (generation !== this.generation) break;
        console.warn("[StreamingTTS] synthesis failed:", err);
        // Continue to next sentence
      }
    }

    this.isProcessing = false;
    if (this.queue.length > 0) {
      void this.processQueue();
    }
  }

  private revokeBlobUrls(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
  }
}
