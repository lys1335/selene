/**
 * Asset relevance scoring and prompt formatting utilities.
 * Extracted from Otter Cards assets-context.ts.
 *
 * All functions are pure -- no side effects, no external dependencies.
 */

/** Metadata about a user-uploaded asset (image, video, etc.) */
export interface AssetInfo {
  /** Unique identifier */
  id: string;
  /** Storage filename */
  filename: string;
  /** Original filename as uploaded by the user */
  originalFilename: string;
  /** Publicly accessible URL */
  publicUrl: string;
  /** MIME type (e.g. "image/png") */
  mimeType: string;
  /** AI-generated description of the asset */
  description?: string;
  /** AI-generated tags */
  tags?: string[];
  /** Dominant colors extracted by AI */
  colors?: string[];
  /** Visual style label (e.g. "minimalist", "retro") */
  style?: string;
  /** Mood label (e.g. "calm", "energetic") */
  mood?: string;
  /** Objects detected in the asset */
  objects?: string[];
  /** Suggested use case */
  useCase?: string;
}

/**
 * Score and rank assets by relevance to a user prompt.
 *
 * Scoring weights:
 *  - description match: +3
 *  - tag match: +2 per tag
 *  - object match: +2 per object
 *  - style match: +1
 *  - mood match: +1
 *  - filename match: +1
 *
 * Returns the top 5 assets sorted by descending score.
 * Assets with score 0 are excluded.
 */
export function findRelevantAssets(prompt: string, assets: AssetInfo[]): AssetInfo[] {
  if (!assets.length) return [];

  const promptLower = prompt.toLowerCase();
  const scored: Array<{ asset: AssetInfo; score: number }> = [];

  for (const asset of assets) {
    let score = 0;

    // Description match
    if (asset.description && asset.description.toLowerCase().includes(promptLower)) {
      score += 3;
    }

    // Tag matches (bidirectional substring check)
    if (asset.tags) {
      for (const tag of asset.tags) {
        const tagLower = tag.toLowerCase();
        if (promptLower.includes(tagLower) || tagLower.includes(promptLower)) {
          score += 2;
        }
      }
    }

    // Object matches (bidirectional substring check)
    if (asset.objects) {
      for (const obj of asset.objects) {
        const objLower = obj.toLowerCase();
        if (promptLower.includes(objLower) || objLower.includes(promptLower)) {
          score += 2;
        }
      }
    }

    // Style match
    if (asset.style && promptLower.includes(asset.style.toLowerCase())) {
      score += 1;
    }

    // Mood match
    if (asset.mood && promptLower.includes(asset.mood.toLowerCase())) {
      score += 1;
    }

    // Filename match
    if (asset.originalFilename.toLowerCase().includes(promptLower)) {
      score += 1;
    }

    if (score > 0) {
      scored.push({ asset, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(item => item.asset);
}

/**
 * Format a list of assets into a text block suitable for inclusion in an
 * AI system/user prompt.
 *
 * Each asset is rendered as a semicolon-delimited line with its filename,
 * description, tags, style, use case, and URL.
 *
 * Returns an empty string when the asset list is empty.
 */
export function formatAssetsForPrompt(assets: AssetInfo[]): string {
  if (!assets.length) return '';

  const assetDescriptions = assets
    .map(asset => {
      const parts = [`- ${asset.originalFilename}`];

      if (asset.description) {
        parts.push(`Description: ${asset.description}`);
      }
      if (asset.tags && asset.tags.length > 0) {
        parts.push(`Tags: ${asset.tags.join(', ')}`);
      }
      if (asset.style) {
        parts.push(`Style: ${asset.style}`);
      }
      if (asset.useCase) {
        parts.push(`Use case: ${asset.useCase}`);
      }
      parts.push(`URL: ${asset.publicUrl}`);

      return parts.join('; ');
    })
    .join('\n');

  return `
USER-PROVIDED ASSETS (MUST BE INCORPORATED):
${assetDescriptions}

IMPORTANT: The user has specifically uploaded these assets to be used in the design. You MUST incorporate them seamlessly into your card design. Use the image URLs directly in <img> tags or as CSS background-images. Make sure they integrate naturally with the overall design aesthetic while maintaining the requested style.`;
}
