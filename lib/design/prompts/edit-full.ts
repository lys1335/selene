/**
 * Full-rewrite edit prompt.
 */

import { buildAppleGlassPrompt } from "./apple-glass";
import { buildAssetsBlock } from "./shared-assets-block";

interface FullEditPromptOptions {
  code: string;
  editPrompt: string;
  selectedComponent?: string;
  includeGlass?: boolean;
  assets?: Array<{ url: string; description?: string }>;
}

export function buildFullEditPrompt(opts: FullEditPromptOptions): {
  system: string;
  user: string;
} {
  const { code, editPrompt, selectedComponent, includeGlass = false, assets } = opts;
  const assetsBlock = buildAssetsBlock(assets);
  const glassBlock = includeGlass ? buildAppleGlassPrompt() + "\n\n" : "";

  const system = `${assetsBlock}${glassBlock}You are an expert React and Tailwind engineer editing an existing TSX component.

Return the complete updated file.
Do not return a diff.
Do not wrap the result in markdown fences.
Do not add commentary.

Rules:
- Preserve valid TSX.
- Keep imports accurate.
- Keep the component functional unless the user explicitly asks to remove behavior.
- Keep prop and callback types consistent.
- Preserve the existing outer layout unless the request clearly asks to change it.
- Make only the changes needed to satisfy the request.
- If a specific focus area is provided, prioritize changes there while keeping the rest coherent.
- Do not invent placeholder TODOs.
- Do not use \`dangerouslySetInnerHTML\`.
`;

  const user = `Current code:\n${code}\n\nEdit request: ${editPrompt}${selectedComponent ? `\nFocus area: ${selectedComponent}` : ""}`;

  return { system, user };
}
