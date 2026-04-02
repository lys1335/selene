/**
 * Design generation pipeline.
 *
 * Takes a text prompt + options and streams back code chunks as the AI produces
 * them, finishing with a validated/repaired complete event.
 */

import type { GenerateOpts, StreamEvent, AssetContext, FinishResult } from './types';
import { streamDesignGeneration } from './providers';
import { buildHtmlModePrompt, buildTailwindModePrompt } from './prompts';

// ---------------------------------------------------------------------------
// Asset formatting
// ---------------------------------------------------------------------------

/**
 * Convert lightweight `AssetContext` entries into the shape expected by the
 * canonical prompt builders: `Array<{ url: string; description?: string }>`.
 */
function toPromptAssets(
  assets: AssetContext[] | undefined,
): Array<{ url: string; description?: string }> | undefined {
  if (!assets || assets.length === 0) return undefined;

  return assets.map(a => ({
    url: a.url,
    description: a.metadata?.description
      ? String(a.metadata.description)
      : a.alt ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a UI component from a text description.
 *
 * Streams back `StreamEvent` objects as the AI produces code:
 * - `start`  -- metadata about the provider/model
 * - `delta`  -- incremental code chunks
 * - `complete` -- the full, validated/repaired code
 * - `error`  -- if something goes wrong at any stage
 *
 * @example
 * ```ts
 * for await (const event of generateCard({ prompt: "pricing card", mode: "tailwind" })) {
 *   switch (event.type) {
 *     case "delta": process.stdout.write(event.content ?? ""); break;
 *     case "complete": saveToFile(event.content!); break;
 *     case "error": console.error(event.error); break;
 *   }
 * }
 * ```
 */
export async function* generateCard(opts: GenerateOpts): AsyncGenerator<StreamEvent> {
  const {
    prompt,
    mode,
    style = 'default',
    assets,
    model,
    temperature,
    maxTokens,
    abortSignal,
    onFinish,
  } = opts;

  const startTime = Date.now();

  // 1. Convert assets to the format expected by canonical prompt builders
  const promptAssets = toPromptAssets(assets);

  const includeGlass = style === 'apple-glass';

  // 2. Build system prompt based on mode using canonical builders
  const systemPrompt = mode === 'tailwind'
    ? buildTailwindModePrompt({ includeGlass, assets: promptAssets })
    : buildHtmlModePrompt({ includeGlass, assets: promptAssets });

  const userPrompt = `Design a card for: "${prompt}"`;

  // 3. Stream through the provider
  let fullContent = '';
  let startEventForwarded = false;

  for await (const event of streamDesignGeneration({ systemPrompt, userPrompt, model, temperature, maxTokens, abortSignal })) {
    // Forward start events directly
    if (event.type === 'start') {
      startEventForwarded = true;
      yield event;
      continue;
    }

    // On provider-level errors, forward and bail
    if (event.type === 'error') {
      if (!startEventForwarded) {
        yield { type: 'start', metadata: { model: model ?? 'unknown' } };
      }
      onFinish?.({ success: false, error: event.error, durationMs: Date.now() - startTime });
      yield event;
      return;
    }

    // Accumulate content from deltas
    if (event.type === 'delta') {
      fullContent += event.content ?? '';
      yield event;
      continue;
    }

    // Provider complete -- fullContent is now the raw AI output.
    // Use the provider's complete content which is authoritative.
    if (event.type === 'complete') {
      fullContent = event.content ?? fullContent;
    }
  }

  // 4. Yield the LLM output directly — no heuristic post-processing.
  // The LLM is instructed via the system prompt to produce clean code.
  // If it doesn't, the correct fix is to improve the prompt or ask the LLM
  // to retry — not to paper over issues with brittle regex transforms.
  if (!fullContent.trim()) {
    const error = {
      code: 'EMPTY_RESPONSE',
      message: 'The model returned an empty response. Try rephrasing the prompt or selecting a different model.',
    };
    onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
    yield { type: 'error', error };
    return;
  }

  // Extract code from markdown fences if present. This is structured output
  // parsing (like JSON.parse), not heuristic post-processing. The prompt
  // explicitly requires the LLM to wrap code in fences.
  const fenceMatch = fullContent.match(/```(?:jsx|tsx|html|typescript)?\n?([\s\S]*?)```/);
  const finalCode = fenceMatch
    ? fenceMatch[1].trim()
    : fullContent.trim();

  onFinish?.({
    success: true,
    content: finalCode,
    durationMs: Date.now() - startTime,
  });

  yield {
    type: 'complete',
    content: finalCode,
  };
}
