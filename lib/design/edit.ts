/**
 * Design editing pipeline.
 *
 * Takes existing code + an edit instruction and streams back the modified
 * result. Supports two modes:
 *
 *  - **Inline mode** (default): The AI returns `@lines N-M ... @end` patches
 *    that are surgically applied to the original code.
 *  - **Full rewrite mode**: The AI returns a complete replacement, streamed
 *    directly with real-time JSX repair.
 */

import type { EditOpts, StreamEvent, FinishResult, AssetContext } from './types';
import { streamDesignGeneration } from './providers';
import { buildInlineEditPrompt, buildFullEditPrompt } from './prompts';
import { applyInlineEdits } from './utils/parse';

// ---------------------------------------------------------------------------
// Asset formatting — placeholder pattern
// ---------------------------------------------------------------------------

function buildAssetPlaceholders(assets: AssetContext[] | undefined): {
  promptAssets: Array<{ url: string; description?: string }> | undefined;
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

function substituteAssetPlaceholders(code: string, assetMap: Map<string, string>): string {
  let result = code;
  for (const [placeholder, url] of assetMap) {
    result = result.replaceAll(placeholder, url);
  }
  return result;
}

function sanitizeMediaPaths(code: string): string {
  return code.replace(
    /(?:\/[^\s'"()]+|\.local-data)\/media\/([\w-]+\/[\w-]+\/[^\s'"()]+\.(?:png|jpe?g|gif|webp|svg))/gi,
    '/api/media/$1',
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

/**
 * Edit an existing component with a text instruction.
 *
 * Supports inline mode (`@lines N-M` patches applied to the original) and full
 * rewrite mode (the AI returns the entire modified file).
 *
 * Streams back `StreamEvent` objects:
 * - `start`    -- metadata about the provider/model
 * - `delta`    -- incremental chunks (raw @lines text in inline mode, or
 *                 progressively-repaired JSX in full mode)
 * - `complete` -- the final, repaired code
 * - `error`    -- if something goes wrong at any stage
 *
 * @example
 * ```ts
 * for await (const event of editCard({ code: existing, editPrompt: "make it blue" })) {
 *   if (event.type === "complete") applyUpdate(event.content!);
 * }
 * ```
 */
export async function* editCard(opts: EditOpts): AsyncGenerator<StreamEvent> {
  const {
    code,
    editPrompt,
    selectedComponent,
    inlineMode = true,
    assets,
    model,
    temperature,
    maxTokens,
    abortSignal,
    onFinish,
  } = opts;

  const startTime = Date.now();

  if (!code.trim()) {
    const error = {
      code: 'EMPTY_SOURCE',
      message: 'Cannot edit empty code. Generate a component first.',
    };
    onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
    yield { type: 'error', error };
    return;
  }

  // Detect Apple Glass style context — require compound keywords to avoid
  // false positives on standalone "glass" (e.g. "wine glass", "glass table")
  const promptLower = editPrompt.toLowerCase();
  const includeGlass =
    promptLower.includes('apple glass') ||
    promptLower.includes('liquid glass') ||
    promptLower.includes('glass effect') ||
    promptLower.includes('glass style') ||
    promptLower.includes('glassmorphism') ||
    code.includes('backdrop-filter');

  // 1. Build prompts based on edit mode using the canonical prompt builders
  const { promptAssets, assetMap } = buildAssetPlaceholders(assets);
  const { system: systemPrompt, user: userPrompt } = inlineMode
    ? buildInlineEditPrompt({ code, editPrompt, selectedComponent, assets: promptAssets })
    : buildFullEditPrompt({ code, editPrompt, selectedComponent, includeGlass, assets: promptAssets });

  // Extract multimodal image parts from resolved assets
  const imageContentParts = assets
    ?.filter(a => a.base64Data && a.mediaType)
    .map(a => ({
      base64Data: a.base64Data!,
      mediaType: a.mediaType!,
      label: a.alt ?? `Asset ${a.id}`,
    }));

  // 2. Stream through the provider
  let fullResponse = '';
  let startEventForwarded = false;

  if (inlineMode) {
    // -- Inline mode: accumulate the full response, then apply patches ------
    for await (const event of streamDesignGeneration({ systemPrompt, userPrompt, imageContentParts: imageContentParts?.length ? imageContentParts : undefined, model, temperature, maxTokens, abortSignal })) {
      if (event.type === 'start') {
        startEventForwarded = true;
        yield event;
        continue;
      }

      if (event.type === 'error') {
        if (!startEventForwarded) {
          yield { type: 'start', metadata: { model: model ?? 'unknown' } };
        }
        onFinish?.({ success: false, error: event.error, durationMs: Date.now() - startTime });
        yield event;
        return;
      }

      if (event.type === 'delta') {
        fullResponse += event.content ?? '';
        // Forward deltas so the consumer can show progress (e.g. the raw @lines text)
        yield {
          type: 'delta',
          content: event.content,
          metadata: { isInlineEdit: true },
        };
        continue;
      }

      if (event.type === 'complete') {
        fullResponse = event.content ?? fullResponse;
      }
    }

    // 3. Apply the @lines patches to the original code
    if (!fullResponse.trim()) {
      const error = {
        code: 'EMPTY_EDIT_RESPONSE',
        message: 'The model returned an empty edit response. Try rephrasing the instruction.',
      };
      onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
      yield { type: 'error', error };
      return;
    }

    let finalCode: string;
    try {
      const patched = applyInlineEdits(code, fullResponse);
      const withAssets = assetMap.size > 0 ? substituteAssetPlaceholders(patched, assetMap) : patched;
      finalCode = sanitizeMediaPaths(withAssets);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error applying inline edits';
      const error = {
        code: 'INLINE_EDIT_FAILED',
        message: `Failed to apply inline edits: ${message}`,
      };
      onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
      yield { type: 'error', error };
      return;
    }

    // 4. Validate the patched result
    if (!finalCode.trim()) {
      const error = {
        code: 'EMPTY_RESULT',
        message: 'Inline edits produced empty output. The @lines patches may not have matched the original code.',
      };
      onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
      yield { type: 'error', error };
      return;
    }

    onFinish?.({ success: true, content: finalCode, metadata: { editMode: 'inline' }, durationMs: Date.now() - startTime });
    yield {
      type: 'complete',
      content: finalCode,
      metadata: { editMode: 'inline', rawEdits: fullResponse },
    };
  } else {
    // -- Full rewrite mode: stream LLM output directly ---------------

    for await (const event of streamDesignGeneration({ systemPrompt, userPrompt, imageContentParts: imageContentParts?.length ? imageContentParts : undefined, model, temperature, maxTokens, abortSignal })) {
      if (event.type === 'start') {
        startEventForwarded = true;
        yield event;
        continue;
      }

      if (event.type === 'error') {
        if (!startEventForwarded) {
          yield { type: 'start', metadata: { model: model ?? 'unknown' } };
        }
        onFinish?.({ success: false, error: event.error, durationMs: Date.now() - startTime });
        yield event;
        return;
      }

      if (event.type === 'delta') {
        fullResponse += event.content ?? '';
        yield {
          type: 'delta',
          content: event.content,
          metadata: { isFullContent: true },
        };
        continue;
      }

      if (event.type === 'complete') {
        fullResponse = event.content ?? fullResponse;
      }
    }

    // Final cleanup and repair
    if (!fullResponse.trim()) {
      const error = {
        code: 'EMPTY_EDIT_RESPONSE',
        message: 'The model returned an empty edit response. Try rephrasing the instruction.',
      };
      onFinish?.({ success: false, error, durationMs: Date.now() - startTime });
      yield { type: 'error', error };
      return;
    }

    const rawCode = stripMarkdownFences(fullResponse);
    const withAssets = assetMap.size > 0 ? substituteAssetPlaceholders(rawCode, assetMap) : rawCode;
    const finalCode = sanitizeMediaPaths(withAssets);

    onFinish?.({ success: true, content: finalCode, metadata: { editMode: 'full' }, durationMs: Date.now() - startTime });
    yield {
      type: 'complete',
      content: finalCode,
      metadata: { editMode: 'full' },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract code from markdown fences. Structured output parsing, not heuristic cleanup. */
function stripMarkdownFences(text: string): string {
  const fenceMatch = text.match(/```(?:jsx|tsx|html|typescript)?\n?([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
}
