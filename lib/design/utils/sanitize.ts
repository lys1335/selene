/**
 * HTML sanitization utilities.
 * Extracted from Otter Cards sanitize.ts.
 *
 * The original used `isomorphic-dompurify` (heavy dependency).  This version
 * ships a built-in regex sanitizer but accepts an optional `sanitizer`
 * callback so consumers can plug in DOMPurify or any other engine.
 *
 * All functions are pure -- no side effects, no external dependencies.
 */

/** Tags allowed by default in sanitized output */
const DEFAULT_ALLOWED_TAGS = new Set([
  'a', 'b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code',
  'pre', 'span', 'div', 'img', 'video', 'audio', 'source',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption',
  'article', 'section', 'header', 'footer', 'nav', 'aside',
  'figure', 'figcaption', 'mark', 'small', 'sub', 'sup',
  'button', 'input', 'label', 'select', 'option', 'textarea',
  'form', 'fieldset', 'legend',
]);

/** Tags that are always stripped regardless of allowlist */
const FORBIDDEN_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'link', 'meta',
]);

/** Attribute patterns that are always removed (event handlers) */
const FORBIDDEN_ATTR_PATTERN = /^on\w+$/i;

/** Attributes that carry URLs and must be sanitized against dangerous protocols */
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background',
]);

const PRESERVED_SCRIPT_PREFIX = 'SELENEPRESERVEDSCRIPT';
const PRESERVED_SCRIPT_SUFFIX = 'ENDSELENE';
const PRESERVED_STYLE_PREFIX = 'SELENEPRESERVEDSTYLE';
const PRESERVED_STYLE_SUFFIX = 'ENDSELENE';

/** Tags allowed in AI-generated content (more restrictive -- no form elements) */
const AI_ALLOWED_TAGS = new Set([...DEFAULT_ALLOWED_TAGS].filter(
  tag => !['form', 'input', 'button', 'select', 'textarea'].includes(tag),
));

/** SVG-specific tags */
const SVG_ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line',
  'polyline', 'polygon', 'text', 'tspan', 'defs', 'clipPath',
  'linearGradient', 'radialGradient', 'stop', 'image', 'pattern',
  'mask', 'filter', 'feGaussianBlur', 'feOffset', 'feBlend',
  'feMerge', 'feMergeNode', 'marker', 'animateTransform', 'set',
  'animate', 'animateMotion', 'title', 'desc', 'use', 'symbol',
]);

interface SanitizeOptions {
  /** Use stricter rules for AI-generated content (no forms, no inline styles) */
  isAIContent?: boolean;
  /** Allow SVG-specific tags */
  isSVG?: boolean;
  /** Explicitly allow or forbid inline style attributes */
  allowStyles?: boolean;
  /**
   * Allow `data:` and `blob:` URL protocols in non-navigation attributes
   * (src, poster, background). These are blocked in navigation attributes
   * (href, action, formaction) regardless of this setting.
   *
   * Use for design workspace content where user-uploaded images and
   * locally-generated previews need to render inline.
   */
  allowDataUrls?: boolean;
  /**
   * Allow inline `<script>` tags in the sanitized output. ONLY use this for
   * first-party trusted templates that we build ourselves and feed straight
   * into a sandboxed renderer (Puppeteer with CSP, sandboxed iframe, etc.).
   *
   * Rationale: the design workspace compiles user component source through
   * esbuild and wraps the resulting JS in our own `<script>` block (to fire
   * `data-preview-ready`). Unconditional `<script>` stripping breaks that
   * hydration handshake — Puppeteer then times out with `Waiting failed`.
   *
   * iframe / object / embed / link / meta remain forbidden regardless; this
   * flag only narrows the forbidden set to exclude `<script>`. Event-handler
   * attributes (onclick etc.) and URL attrs are still scrubbed.
   *
   * Do NOT set this for any sanitizer call that processes AI-generated or
   * user-pasted HTML.
   */
  allowInlineScripts?: boolean;
  /**
   * Optional external sanitizer function.  When provided, it replaces the
   * built-in regex sanitizer entirely.  Useful for plugging in DOMPurify.
   */
  sanitizer?: (html: string) => string;
}

/**
 * Built-in regex-based HTML sanitizer.
 *
 * This is intentionally simple -- it strips forbidden tags and event-handler
 * attributes but does NOT attempt full DOM parsing.  For production use with
 * untrusted user input, pass a real sanitizer (e.g. DOMPurify) via the
 * `sanitizer` option.
 */
/** Navigation attributes where data:/blob: are never allowed (XSS risk) */
const NAVIGATION_ATTRS = new Set(['href', 'action', 'formaction', 'xlink:href']);

/**
 * Structural document tags. These are stripped by default because the
 * default sanitizer use case is rich-text fragments inserted into an
 * existing document — emitting nested `<html>`/`<head>`/`<body>` would
 * be invalid. The design workspace preview pipeline emits a FULL HTML
 * document and feeds it to `puppeteer.setContent`; in that pipeline we
 * MUST preserve the structural tags so attributes like `<html class="dark">`
 * (the Tailwind dark-mode hook) survive into the rendered page. Gated on
 * `allowInlineScripts` because both flags are for first-party trusted
 * templates only.
 */
const STRUCTURAL_DOC_TAGS = new Set(['html', 'head', 'body']);

function regexSanitize(
  dirty: string,
  allowedTags: Set<string>,
  stripStyles: boolean,
  allowDataUrls = false,
  allowInlineScripts = false,
): string {
  let result = dirty;
  const preservedScripts: string[] = [];
  const preservedStyles: string[] = [];

  // When the caller is feeding a full HTML document (gated on the same
  // first-party trust signal as `allowInlineScripts`), expand the allowlist
  // to keep the structural tags + their attributes intact. Without this,
  // `<html class="dark">` becomes `…` and Tailwind's `dark:` variants stay
  // inert — which is why screenshots run with `previewTheme: "dark"`
  // historically rendered indistinguishable from the light variant.
  const effectiveAllowedTags = allowInlineScripts
    ? new Set([...allowedTags, ...STRUCTURAL_DOC_TAGS])
    : allowedTags;

  if (allowInlineScripts) {
    result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (scriptBlock) => {
      const index = preservedScripts.push(scriptBlock) - 1;
      return `${PRESERVED_SCRIPT_PREFIX}${index}${PRESERVED_SCRIPT_SUFFIX}`;
    });
  }
  if (!stripStyles) {
    result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (styleBlock) => {
      const index = preservedStyles.push(styleBlock) - 1;
      return `${PRESERVED_STYLE_PREFIX}${index}${PRESERVED_STYLE_SUFFIX}`;
    });
  }

  // Remove forbidden tags and their content. When `allowInlineScripts` is
  // true, complete `<script>...</script>` blocks are preserved above before
  // the generic tag scrubber runs. Likewise, when style tags are allowed,
  // complete `<style>...</style>` blocks are preserved. That keeps literal
  // tag-like strings inside first-party preview JS/CSS from being mistaken
  // for HTML tags and corrupting the rendered preview.
  const forbiddenForThisCall = allowInlineScripts
    ? new Set([...FORBIDDEN_TAGS].filter((t) => t !== 'script'))
    : FORBIDDEN_TAGS;
  for (const tag of forbiddenForThisCall) {
    const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi');
    result = result.replace(re, '');
    // Also remove self-closing variants
    const reSelf = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    result = result.replace(reSelf, '');
  }

  // Normalize solidus between tag name and attributes (e.g. <div/onclick=...> → <div onclick=...>)
  // This prevents bypassing the event handler regex which requires \s+ before on* attributes.
  result = result.replace(/<([a-zA-Z][a-zA-Z0-9]*)\//g, '<$1 ');

  // Remove tags not in the allowlist (keep their content). When
  // `allowInlineScripts` is true, `<script>` is implicitly allowed (open +
  // close tags preserved) alongside the caller's allowlist so the content
  // between the tags survives verbatim. Event-handler / URL-attr scrubbing
  // still applies to non-script tags via the normal allowedTags path.
  result = result.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tagName: string) => {
    const lowered = tagName.toLowerCase();
    if (allowInlineScripts && lowered === 'script') {
      return match;
    }
    if (effectiveAllowedTags.has(lowered) || effectiveAllowedTags.has(tagName)) {
      // Tag is allowed -- strip event handler attributes (also handles newline-split attrs)
      let cleaned = match.replace(/[\s/]+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      // Strip style attribute if requested
      if (stripStyles) {
        cleaned = cleaned.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      }
      // Sanitize URL-bearing attributes -- remove attr if protocol is dangerous.
      // This regex sanitizer is a defense-in-depth layer; it handles quoted
      // (double and single) as well as unquoted attribute values to prevent
      // bypasses via attr=javascript:... without quotes.
      cleaned = cleaned.replace(
        /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (attrMatch, attrName: string, doubleVal?: string, singleVal?: string, unquotedVal?: string) => {
          if (URL_ATTRIBUTES.has(attrName.toLowerCase())) {
            const rawValue = doubleVal ?? singleVal ?? unquotedVal ?? '';
            // Never allow data:/blob: in navigation attributes (href, action, etc.)
            const attrAllowData = allowDataUrls && !NAVIGATION_ATTRS.has(attrName.toLowerCase());
            const safe = sanitizeURL(rawValue, { allowDataUrls: attrAllowData });
            if (!safe) return ''; // dangerous protocol -- remove entire attribute
            return ` ${attrName}="${safe}"`;
          }
          return attrMatch;
        },
      );
      return cleaned;
    }
    // Tag not allowed -- remove the tag but keep inner content
    return '';
  });

  if (allowInlineScripts && preservedScripts.length > 0) {
    result = result.replace(
      new RegExp(`${PRESERVED_SCRIPT_PREFIX}(\\d+)${PRESERVED_SCRIPT_SUFFIX}`, 'g'),
      (_match, rawIndex: string) => {
        const index = Number(rawIndex);
        return preservedScripts[index] ?? '';
      },
    );
  }
  if (!stripStyles && preservedStyles.length > 0) {
    result = result.replace(
      new RegExp(`${PRESERVED_STYLE_PREFIX}(\\d+)${PRESERVED_STYLE_SUFFIX}`, 'g'),
      (_match, rawIndex: string) => {
        const index = Number(rawIndex);
        return preservedStyles[index] ?? '';
      },
    );
  }

  return result;
}

/**
 * Sanitize an HTML string to prevent XSS attacks.
 *
 * When no external `sanitizer` is provided, uses a built-in regex-based
 * approach.  Pass `sanitizer` for stronger guarantees with untrusted input.
 */
export function sanitizeHTML(dirty: string, options?: SanitizeOptions): string {
  if (!dirty) return '';

  // Delegate to external sanitizer when available
  if (options?.sanitizer) {
    return options.sanitizer(dirty);
  }

  let allowedTags: Set<string>;
  let stripStyles = false;

  if (options?.isSVG) {
    allowedTags = SVG_ALLOWED_TAGS;
  } else if (options?.isAIContent) {
    allowedTags = AI_ALLOWED_TAGS;
    // AI content strips inline styles by default, but callers can override
    // via allowStyles (e.g. design workspace components need inline styles).
    stripStyles = options?.allowStyles !== true;
  } else {
    allowedTags = DEFAULT_ALLOWED_TAGS;
  }

  if (options?.allowStyles === false) {
    stripStyles = true;
  } else if (options?.allowStyles === true) {
    stripStyles = false;
  }

  return regexSanitize(
    dirty,
    allowedTags,
    stripStyles,
    options?.allowDataUrls,
    options?.allowInlineScripts,
  );
}

/**
 * Validate and sanitize a URL.
 *
 * By default only `http:`, `https:`, and `mailto:` protocols are permitted.
 * Pass `allowDataUrls: true` to also permit `data:` and `blob:` protocols
 * (for non-navigation attributes like img src in design workspace content).
 *
 * Invalid URLs have protocol-like prefixes stripped and are returned as
 * relative paths.
 */
function sanitizeURL(url: string, opts?: { allowDataUrls?: boolean }): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    const allowed = ['http:', 'https:', 'mailto:'];
    if (opts?.allowDataUrls) {
      allowed.push('data:', 'blob:');
    }
    if (!allowed.includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    // Not a valid absolute URL -- strip protocol-like prefixes
    return url.replace(/^[a-zA-Z0-9+.-]+:/, '');
  }
}
