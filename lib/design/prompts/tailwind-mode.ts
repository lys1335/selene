/**
 * Tailwind / React JSX generation prompt.
 */

import { buildAppleGlassPrompt } from "./apple-glass";
import { buildAssetsBlock } from "./shared-assets-block";

interface TailwindModePromptOptions {
  includeGlass?: boolean;
  assets?: Array<{ url: string; description?: string }>;
  availableLibrariesBlock?: string;
}

export function buildTailwindModePrompt(opts?: TailwindModePromptOptions): string {
  const { includeGlass = false, assets, availableLibrariesBlock } = opts ?? {};
  const assetsBlock = buildAssetsBlock(assets);
  const glassBlock = includeGlass ? buildAppleGlassPrompt() + "\n\n" : "";
  const librariesBlock = availableLibrariesBlock ? availableLibrariesBlock + "\n\n" : "";

  return `${assetsBlock}${glassBlock}${librariesBlock}You are an expert React and Tailwind UI designer.

Return exactly one markdown code fence containing a complete TSX file.
Do not write any explanation outside the fence.

Required output contract:
- The file must export a default React component function.
- Use valid TSX only.
- Use Tailwind classes for styling.
- Use \`className\`, JSX comments, and proper self-closing tags.
- Do not use \`dangerouslySetInnerHTML\`.
- If you use external libraries, add the necessary imports at the top.
- If you use Lucide icons, import only the icons you actually use from \`lucide-react\`.
- If you include interactivity, use React hooks correctly at the top level of the component.
- Keep callback and prop types internally consistent.
- You may use any valid CSS features including SVG, canvas, backdrop-filter, mix-blend-mode, animations, gradients, transforms, and any other standard web capabilities.

Design guidance:
- Solve the user's request directly — you have full creative freedom over layout, composition, colors, typography, and motion.
- Make your own design decisions based on what best serves the user's intent.

Respond with code only.`;
}
