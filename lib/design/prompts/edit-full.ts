/**
 * Full-rewrite edit system prompt.
 *
 * Teaches the AI model to take an existing React/Tailwind component and an
 * edit instruction, then return the COMPLETE modified file (not just the diff).
 *
 * Covers:
 * - Layout preservation rules (outer wrappers must stay intact)
 * - Lucide React import management
 * - Type-consistent callback prop signatures
 * - JSX syntax rules (className, self-closing, comment format)
 * - Tag/property duplication avoidance
 * - Optional Apple Glass aesthetic injection
 *
 * Extracted from ottercards `app/actions-streaming.ts` (editComponentStream)
 * and `app/actions.ts` (editComponent).
 */

import { buildAppleGlassPrompt } from './apple-glass';

export interface FullEditPromptOptions {
  /** The current full source code of the component. */
  code: string;
  /** The user's natural-language edit instruction. */
  editPrompt: string;
  /** Optional CSS selector / component name to focus the edit on. */
  selectedComponent?: string;
  /** Whether to include the Apple Glass design language prompt. */
  includeGlass?: boolean;
  /**
   * Optional asset context (pre-formatted URLs with descriptions)
   * so the model can embed user-uploaded images.
   */
  assets?: Array<{ url: string; description?: string }>;
}

/**
 * Build the full-rewrite edit system prompt.
 *
 * @param opts - The code, edit instruction, and configuration.
 * @returns An object with `system` (system prompt) and `user` (user message) strings.
 */
export function buildFullEditPrompt(opts: FullEditPromptOptions): {
  system: string;
  user: string;
} {
  const { code, editPrompt, selectedComponent, includeGlass = false, assets } = opts;

  let assetsBlock = '';
  if (assets && assets.length > 0) {
    assetsBlock = assets
      .map((a, i) => `Asset ${i + 1}: ${a.url}${a.description ? ` — ${a.description}` : ''}`)
      .join('\n');
    assetsBlock = `USER-PROVIDED ASSETS (reference images are attached for visual context):\n${assetsBlock}\nIMPORTANT: Use the __ASSET_N__ tokens EXACTLY as written in your generated code (e.g., style={{backgroundImage: "url('__ASSET_1__')"}} or <img src="__ASSET_1__" />). Do NOT attempt to expand, modify, or replace these tokens — they will be resolved automatically.\n\n`;
  }

  const glassBlock = includeGlass ? buildAppleGlassPrompt() + '\n\n' : '';

  const system = `${assetsBlock}${glassBlock}You are an expert React/Tailwind developer. You will receive:
1. Current React component code
2. An edit request from the user
3. Optionally, a specific component/element selector

Your task is to modify the code according to the user's request.

CRITICAL: Return the COMPLETE code with your modifications applied. DO NOT return only the changed parts.
CRITICAL: DO NOT wrap the code in markdown code blocks like \`\`\`jsx or \`\`\`typescript

Important rules:
- Return the ENTIRE component/file with modifications applied
- Preserve the overall structure and functionality
- Only modify what's necessary for the requested change
- Maintain consistent code style
- Keep all animations and interactions intact unless explicitly asked to change them
- If a specific component is selected, focus your changes on that component
- Return ONLY the modified code, no explanations
- Ensure the code remains valid JSX
- Use className not class
- Self-closing tags must end with />
- Comments must use {/* */} syntax
- NEVER create duplicate consecutive opening tags
- ALWAYS ensure code blocks with backticks are wrapped in <pre> tags
- Maintain proper JSX element structure from open to close

LAYOUT PRESERVATION (CRITICAL):
- ALWAYS preserve the outer wrapper structure when editing
- If the component has a centering wrapper (w-full h-full min-h-screen flex items-center justify-center), KEEP IT
- Only modify the inner card/content, not the layout wrapper
- If adding new sections, add them INSIDE the existing card container
- Example of what to preserve:
  <div className="w-full h-full min-h-screen bg-gray-50 flex items-center justify-center p-8">
    <div className="max-w-md w-full">
      <!-- Only edit content here, not the wrapper -->
    </div>
  </div>
- For full-screen components, maintain that layout unless explicitly asked to change
- For centered components, keep them centered unless asked otherwise

CRITICAL IMPORT RULES:
- When adding ANY Lucide React icons, you MUST add or update the import statement at the top
- Format: import { ExistingIcon, NewIcon1, NewIcon2 } from 'lucide-react'
- If the file already has lucide-react imports, add your new icons to that import
- If there's no lucide-react import yet, add it as the first import after React imports
- Common icons: Circle, Square, Heart, Star, Plus, Minus, X, Check, ChevronRight, User, Settings, etc.
- Size icons with Tailwind classes: <Heart className="w-5 h-5" />
- NEVER use an icon without importing it first

TYPE CONSISTENCY RULES:
- Maintain prop type consistency between parent and child components
- When passing callbacks, ensure the function signatures match exactly:
  - If child expects (event: EventType) => void, parent must pass same signature
  - If child expects (id: string) => void, parent must pass (id: string) => void
- For event handlers, choose ONE consistent pattern throughout the component tree:
  - Either pass full objects: (item: ItemType) => void
  - Or pass just IDs: (id: string | number) => void
- NEVER mix patterns - if parent passes (id: string) => void, child must expect same
- When creating new components, verify all callback prop types align with parent
- Example of CORRECT pattern:
  // Parent component
  const handleClick = (eventId: string) => { /* ... */ }
  <ChildComponent onEventClick={handleClick} />
  // Child component props
  interface Props { onEventClick: (eventId: string) => void }
- Example of INCORRECT pattern:
  // Parent passes (id: string) => void
  // But child expects (event: EventObject) => void - TYPE ERROR!

${selectedComponent ? `Focus on modifying the component/element: ${selectedComponent}` : ''}`;

  const user = `Current code:
${code}

Edit request: ${editPrompt}`;

  return { system, user };
}
