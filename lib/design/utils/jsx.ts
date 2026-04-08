/**
 * JSX utility functions for validation, conversion, repair, and streaming-safe truncation.
 * Extracted from Otter Cards jsx-utils.ts.
 *
 * All functions are pure -- no side effects, no external dependencies.
 */

/** HTML void elements that must self-close in JSX */
const SELF_CLOSING_TAGS = [
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
] as const;

/**
 * Convert an HTML string to valid JSX.
 *
 * Handles:
 * - `class` -> `className`
 * - `for` -> `htmlFor`
 * - HTML comments -> JSX comments
 * - Void elements get self-closing slash
 * - Inline `style="..."` strings -> `style={{ ... }}` objects
 */
export function htmlToJsx(html: string): string {
  let jsx = html.replace(/\sclass=/g, ' className=');

  jsx = jsx.replace(/\sfor=/g, ' htmlFor=');

  jsx = jsx.replace(/<!--\s*(.*?)\s*-->/g, '{/* $1 */}');

  // Ensure void elements are self-closed
  jsx = jsx.replace(/<(\w+)([^>]*?)>/g, (match, tag: string, attrs: string) => {
    if (
      SELF_CLOSING_TAGS.includes(tag.toLowerCase() as typeof SELF_CLOSING_TAGS[number]) &&
      !match.endsWith('/>')
    ) {
      return `<${tag}${attrs} />`;
    }
    return match;
  });

  // Convert inline style strings to JSX style objects
  jsx = jsx.replace(/style="([^"]*)"/g, (_match, styles: string) => {
    try {
      const styleObj: Record<string, string> = {};
      for (const decl of styles.split(';')) {
        const [key, value] = decl.split(':').map(s => s.trim());
        if (key && value) {
          // kebab-case -> camelCase
          const camelKey = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
          styleObj[camelKey] = value;
        }
      }
      return `style={${JSON.stringify(styleObj)}}`;
    } catch {
      return _match;
    }
  });

  return jsx;
}

/** Result of JSX validation */
export interface JsxValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a JSX string for common issues.
 *
 * Checks for HTML-only patterns that are invalid in JSX:
 * - HTML comments (`<!-- -->`)
 * - `class=` instead of `className=`
 * - `for=` instead of `htmlFor=`
 */
export function validateJsx(jsx: string): JsxValidationResult {
  const errors: string[] = [];

  if (jsx.includes('<!--')) {
    errors.push('HTML comments (<!-- -->) are not allowed in JSX');
  }
  if (/\sclass=/.test(jsx)) {
    errors.push('Use className instead of class');
  }
  if (/\sfor=/.test(jsx)) {
    errors.push('Use htmlFor instead of for');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Find the last safe truncation point in a partially-streamed JSX string.
 *
 * During streaming, the latest chunk may end inside an open tag or string
 * literal.  This function scans for the last position where no tag or string
 * is left dangling, making it safe to render the prefix.
 *
 * It also performs a rough tag-balance check: if the open-tag surplus exceeds
 * 3, it falls back to cutting at the last `>` character.
 */
export function getLastCompleteJSX(partial: string): string {
  if (!partial || partial.trim() === '') {
    return '';
  }

  let result = partial;

  // State machine: scan for the last position that is outside both
  // string literals and open tags.
  let i = 0;
  let inString = false;
  let stringChar = '';
  let inTag = false;
  let lastSafePoint = 0;

  // Track JSX expression depth to distinguish `<` in `{count < max}` from tags
  let jsxExprDepth = 0;

  while (i < partial.length) {
    const char = partial[i];
    const prevChar = i > 0 ? partial[i - 1] : '';

    // Track string boundaries (handles ", ', and ` delimiters)
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        if (!inTag) {
          lastSafePoint = i + 1;
        }
      }
    }

    // Track JSX expression boundaries { ... } when outside strings
    if (!inString && !inTag) {
      if (char === '{') {
        jsxExprDepth++;
      } else if (char === '}' && jsxExprDepth > 0) {
        jsxExprDepth--;
        if (jsxExprDepth === 0) {
          lastSafePoint = i + 1;
        }
      }
    }

    // Track tag boundaries when outside a string AND outside JSX expressions
    // This prevents `<` in `{count < max}` from being treated as a tag open
    if (!inString && jsxExprDepth === 0) {
      if (char === '<' && i + 1 < partial.length) {
        // Only treat as tag if followed by a letter, slash, or exclamation
        const nextChar = partial[i + 1];
        if (/[a-zA-Z/!]/.test(nextChar)) {
          inTag = true;
        }
      } else if (char === '>' && inTag) {
        inTag = false;
        lastSafePoint = i + 1;
      }
    }

    i++;
  }

  // If we ended inside a string or tag, cut at the last safe point
  if (inString || inTag) {
    result = partial.substring(0, lastSafePoint);
  }

  // Strip trailing incomplete attributes (e.g. `className=` with no value)
  const incompleteAttrMatch = result.match(/\s+\w+\s*=\s*$/);
  if (incompleteAttrMatch) {
    result = result.substring(0, result.length - incompleteAttrMatch[0].length);
  }

  // Rough tag-balance check
  const openTags = (result.match(/<[^/][^>]*>/g) || []).length;
  const closeTags = (result.match(/<\/[^>]+>/g) || []).length;
  const selfClosingTags = (result.match(/<[^>]*\/>/g) || []).length;

  if (openTags - closeTags - selfClosingTags > 3) {
    const lastCloseTag = result.lastIndexOf('>');
    if (lastCloseTag > 0) {
      result = result.substring(0, lastCloseTag + 1);
    }
  }

  return result.trim();
}

/**
 * Repair common JSX issues that AI models produce, especially during inline
 * edits.
 *
 * Repair pipeline (in order):
 *  0. Fix malformed self-closing tags (`/ />` -> `/>`)
 *  1. Remove duplicate consecutive opening tags
 *  2. Wrap bare code blocks in `<pre>` when missing
 *  3. Detect and append missing closing tags
 *  4. Convert leftover HTML comments to JSX comments
 *  5. `class=` -> `className=`
 *  6. Remove excess closing `</div>` tags
 *  7. Additional self-closing tag cleanup pass
 *  8. Deduplicate CSS properties inside `<style>` blocks
 *  9. Remove empty media queries with orphaned rules
 * 10. Fix `className` inside HTML template literals (back to `class`)
 */
export function repairInlineEditJSX(jsxContent: string): string {
  if (!jsxContent || jsxContent.trim() === '') {
    return jsxContent;
  }

  let repaired = jsxContent;

  // --- Fix 0: malformed self-closing tags (common Kimi model issue) ---
  // "/ >" -> "/>"
  repaired = repaired.replace(/\/\s+>/g, '/>');
  // '" / >' -> '"/>'
  repaired = repaired.replace(/"\s*\/\s+>/g, '"/>');
  // "' / >" -> "'/>"
  repaired = repaired.replace(/'\s*\/\s+>/g, "'/>"); // eslint-disable-line quotes
  // any_attribute / > -> any_attribute />
  repaired = repaired.replace(/(\w+|"[^"]*")\s*\/\s+>/g, '$1 />');

  // --- Fix 1: Remove duplicate consecutive opening tags ---
  const duplicateTagPattern = /(<(\w+)(?:\s+[^>]*)?>)\s*\n\s*\1/g;
  repaired = repaired.replace(duplicateTagPattern, '$1');

  // --- Fix 2: Wrap bare code blocks (`{`...`}`) in <pre> if missing ---
  const codeBlockPattern = /(\n\s*)(\{`[^`]+`\})(\s*\n)/g;
  repaired = repaired.replace(codeBlockPattern, (match, before: string, codeBlock: string, after: string) => {
    const preceding = repaired.substring(0, repaired.indexOf(match));
    const lastFewLines = preceding.split('\n').slice(-3).join('\n');
    if (!lastFewLines.includes('<pre') && !lastFewLines.includes('<code')) {
      return `${before}<pre className="text-xs whitespace-pre">${codeBlock}</pre>${after}`;
    }
    return match;
  });

  // --- Fix 3: Track unclosed tags (informational -- currently no auto-close) ---
  const tagStack: Array<{ tag: string; position: number }> = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(repaired)) !== null) {
    const fullTag = tagMatch[0];
    const tagName = tagMatch[1].toLowerCase();

    if (
      fullTag.endsWith('/>') ||
      (SELF_CLOSING_TAGS as readonly string[]).includes(tagName)
    ) {
      continue;
    }

    if (fullTag.startsWith('</')) {
      const openingIdx = tagStack.findIndex(t => t.tag === tagName);
      if (openingIdx !== -1) {
        tagStack.splice(openingIdx);
      }
    } else {
      tagStack.push({ tag: tagName, position: tagMatch.index + fullTag.length });
    }
  }

  // --- Fix 4: HTML comments -> JSX comments ---
  repaired = repaired.replace(/<!--\s*(.*?)\s*-->/g, '{/* $1 */}');

  // --- Fix 5: class -> className ---
  repaired = repaired.replace(/\sclass=/g, ' className=');

  // --- Fix 6: Remove excess closing </div> tags ---
  const endingDivPattern = /(<\/div>\s*\n\s*){2,}$/;
  if (endingDivPattern.test(repaired)) {
    const openDivs = (repaired.match(/<div[^>]*>/g) || []).length;
    const closeDivs = (repaired.match(/<\/div>/g) || []).length;

    if (closeDivs > openDivs) {
      let divCount = 0;
      repaired = repaired.replace(/<\/div>/g, (m) => {
        divCount++;
        return divCount > openDivs ? '' : m;
      });
    }
  }

  // --- Fix 7: Second pass on self-closing tag cleanup ---
  repaired = repaired.replace(/\/\s+>/g, '/>');
  repaired = repaired.replace(/\s*\/\s*\/>/g, ' />');
  repaired = repaired.replace(/\s\/\s+>/g, ' />');
  repaired = repaired.replace(/<img([^>]*?)\/\s+>/g, '<img$1 />');

  // --- Fix 8: Deduplicate CSS properties inside <style> blocks ---
  repaired = repaired.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_match, cssContent: string) => {
    // Remove empty media queries
    cssContent = cssContent.replace(/@media[^{]+\{\s*\}/g, '');

    const lines = cssContent.split('\n');
    const processedLines: string[] = [];
    let inMediaQuery = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('@media') && line.includes('{')) {
        inMediaQuery = true;
        processedLines.push(line);
        continue;
      }

      if (line === '}' && inMediaQuery) {
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine && !nextLine.startsWith('@') && !nextLine.startsWith('}')) {
            continue; // skip orphaned closing brace
          }
        }
        inMediaQuery = false;
        processedLines.push(line);
        continue;
      }

      processedLines.push(line);
    }

    // Deduplicate properties within each rule (keep last occurrence)
    const cleanedCss = processedLines.join('\n');
    const rules = cleanedCss.split('}').map(r => r.trim()).filter(Boolean);

    const fixedRules = rules
      .map(rule => {
        if (!rule.includes('{')) return '';
        const [selector, properties] = rule.split('{');
        if (!properties) return rule + '}';

        const propMap = new Map<string, string>();
        for (const prop of properties.split(';').map(p => p.trim()).filter(Boolean)) {
          const colonIdx = prop.indexOf(':');
          if (colonIdx > -1) {
            propMap.set(prop.substring(0, colonIdx).trim(), prop);
          }
        }

        const uniqueProps = Array.from(propMap.values()).join(';\n      ');
        return `${selector}{\n      ${uniqueProps}${uniqueProps ? ';' : ''}\n    }`;
      })
      .filter(Boolean);

    return `<style>${fixedRules.join('\n    ')}</style>`;
  });

  // --- Fix 9: Empty media query followed by orphaned rule ---
  repaired = repaired.replace(/@media[^{]+\{\s*\}\s*\.\w+[^{]*\{[^}]*\}/g, (match) => {
    const ruleMatch = match.match(/(\.\w+[^{]*\{[^}]*\})/);
    return ruleMatch ? ruleMatch[1] : '';
  });

  // --- Fix 10: Inside HTML template literals, convert className back to class ---
  if (repaired.includes('const cardHTML = `') || repaired.includes('const html = `')) {
    const templateMatch = repaired.match(/const\s+\w+\s*=\s*`([\s\S]*?)`/);
    if (templateMatch) {
      const fixedHtml = templateMatch[1].replace(/\sclassName=/g, ' class=');
      repaired = repaired.replace(templateMatch[1], fixedHtml);
    }
  }

  return repaired.trim();
}
