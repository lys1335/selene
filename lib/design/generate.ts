/**
 * Design generation pipeline.
 *
 * Takes a text prompt + options and streams back code chunks as the AI produces
 * them, finishing with a validated/repaired complete event.
 */

import type { GenerateOpts, StreamEvent, AssetContext, FinishResult } from './types';
import { streamDesignGeneration } from './providers';
import { buildHtmlModePrompt, buildTailwindModePrompt } from './prompts';
import { parseAIResponse } from './utils/parse';
import { htmlToJsx, validateJsx, repairInlineEditJSX } from './utils/jsx';

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

  // 4. Post-process the completed response
  if (!fullContent.trim()) {
    const error = {
      code: 'EMPTY_RESPONSE',
      message: 'The model returned an empty response. Try rephrasing the prompt or selecting a different model.',
    };
    onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
    yield { type: 'error', error };
    return;
  }

  // Strip markdown code fences the model sometimes wraps output in
  let cleanedContent = fullContent
    .replace(/```(?:jsx|tsx|html|typescript)?\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  // Parse out any prose the model may have emitted alongside the code
  const parsed = parseAIResponse(cleanedContent);
  let finalCode = parsed.code;

  // 5. Mode-specific validation and repair
  if (mode === 'tailwind') {
    finalCode = htmlToJsx(finalCode);
    const validation = validateJsx(finalCode);
    if (!validation.valid) {
      // Attempt repair rather than failing outright
      finalCode = repairInlineEditJSX(finalCode);

      const revalidation = validateJsx(finalCode);
      if (!revalidation.valid) {
        const error = {
          code: 'JSX_VALIDATION_FAILED',
          message: `JSX validation errors after repair: ${revalidation.errors.join('; ')}`,
        };
        onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
        yield { type: 'error', error };
        return;
      }
    }
  } else {
    // HTML mode -- still run repair for structural issues (unclosed tags, etc.)
    finalCode = repairInlineEditJSX(finalCode);
  }

  // 6. Yield the final complete event with cleaned-up code
  onFinish?.({
    success: true,
    content: finalCode,
    metadata: { language: parsed.language, description: parsed.description },
    durationMs: Date.now() - startTime,
  });

  yield {
    type: 'complete',
    content: finalCode,
    metadata: {
      language: parsed.language,
      description: parsed.description,
    },
  };
}
