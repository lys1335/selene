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
// Asset formatting — placeholder pattern
// ---------------------------------------------------------------------------

/**
 * Build prompt-safe asset references using `__ASSET_N__` placeholders instead
 * of raw URLs.  The inner design LLM sees (and copies) only the short token;
 * we substitute it with the real URL after generation.  This prevents the LLM
 * from trying to reproduce data-URI base64 strings in its output.
 */
function buildAssetPlaceholders(assets: AssetContext[] | undefined): {
  promptAssets: Array<{ url: string; description?: string }> | undefined;
  /** placeholder → real URL */
  assetMap: Map<string, string>;
} {
  const assetMap = new Map<string, string>();
  if (!assets || assets.length === 0) return { promptAssets: undefined, assetMap };

  const promptAssets = assets.map((a, i) => {
    const placeholder = `__ASSET_${i + 1}__`;
    assetMap.set(placeholder, a.url);
    return {
      url: placeholder,
      description: a.metadata?.description
        ? String(a.metadata.description)
        : a.alt ?? undefined,
    };
  });

  return { promptAssets, assetMap };
}

/** Replace `__ASSET_N__` tokens in generated code with real URLs. */
function substituteAssetPlaceholders(code: string, assetMap: Map<string, string>): string {
  let result = code;
  for (const [placeholder, url] of assetMap) {
    result = result.replaceAll(placeholder, url);
  }
  return result;
}

/**
 * Convert raw filesystem media paths in generated code to `/api/media/` URLs.
 * Catches paths the outer agent embeds directly in the prompt text, bypassing
 * the asset placeholder pipeline. Matches patterns like:
 *   /Users/.../media/sessionId/role/file.png
 *   /home/.../media/sessionId/role/file.png
 *   .local-data/media/sessionId/role/file.png
 */
function sanitizeMediaPaths(code: string): string {
  // Match absolute or relative paths containing /media/ followed by path segments ending in an image extension
  return code.replace(
    /(?:\/[^\s'"()]+|\.local-data)\/media\/([\w-]+\/[\w-]+\/[^\s'"()]+\.(?:png|jpe?g|gif|webp|svg))/gi,
    '/api/media/$1',
  );
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

  // 1. Convert assets to placeholder-based references for the prompt
  const { promptAssets, assetMap } = buildAssetPlaceholders(assets);

  const includeGlass = style === 'apple-glass';

  // 2. Build system prompt based on mode using canonical builders
  const systemPrompt = mode === 'tailwind'
    ? buildTailwindModePrompt({ includeGlass, assets: promptAssets })
    : buildHtmlModePrompt({ includeGlass, assets: promptAssets });

  const userPrompt = `Design a card for: "${prompt}"`;

  // 3. Extract multimodal image parts from resolved assets
  const imageContentParts = assets
    ?.filter(a => a.base64Data && a.mediaType)
    .map(a => ({
      base64Data: a.base64Data!,
      mediaType: a.mediaType!,
      label: a.alt ?? `Asset ${a.id}`,
    }));

  // 4. Stream through the provider
  let fullContent = '';
  let startEventForwarded = false;

  for await (const event of streamDesignGeneration({ systemPrompt, userPrompt, imageContentParts: imageContentParts?.length ? imageContentParts : undefined, model, temperature, maxTokens, abortSignal })) {
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

    // Forward deltas for real-time streaming
    if (event.type === 'delta') {
      yield event;
      continue;
    }

    // Provider complete event carries the authoritative full content
    if (event.type === 'complete') {
      fullContent = event.content;
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
  const rawCode = fenceMatch
    ? fenceMatch[1].trim()
    : fullContent.trim();

  // Substitute __ASSET_N__ placeholders with real URLs, then sanitize any
  // raw filesystem paths the LLM may have copied from the prompt context
  const withAssets = assetMap.size > 0
    ? substituteAssetPlaceholders(rawCode, assetMap)
    : rawCode;
  const finalCode = sanitizeMediaPaths(withAssets);

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
