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

export interface SanitizeOptions {
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

function regexSanitize(
  dirty: string,
  allowedTags: Set<string>,
  stripStyles: boolean,
  allowDataUrls = false,
): string {
  let result = dirty;

  // Remove forbidden tags and their content
  for (const tag of FORBIDDEN_TAGS) {
    const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi');
    result = result.replace(re, '');
    // Also remove self-closing variants
    const reSelf = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    result = result.replace(reSelf, '');
  }

  // Normalize solidus between tag name and attributes (e.g. <div/onclick=...> → <div onclick=...>)
  // This prevents bypassing the event handler regex which requires \s+ before on* attributes.
  result = result.replace(/<([a-zA-Z][a-zA-Z0-9]*)\//g, '<$1 ');

  // Remove tags not in the allowlist (keep their content)
  result = result.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tagName: string) => {
    if (allowedTags.has(tagName.toLowerCase()) || allowedTags.has(tagName)) {
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

  return regexSanitize(dirty, allowedTags, stripStyles, options?.allowDataUrls);
}

/**
 * Sanitize SVG content specifically.
 * Shorthand for `sanitizeHTML(svg, { isSVG: true })`.
 */
export function sanitizeSVG(svgContent: string, sanitizer?: (html: string) => string): string {
  return sanitizeHTML(svgContent, { isSVG: true, sanitizer });
}

/**
 * Create a `{ __html: string }` object safe for use with React's
 * `dangerouslySetInnerHTML`.
 */
export function createSafeHTML(
  html: string,
  options?: SanitizeOptions,
): { __html: string } {
  return { __html: sanitizeHTML(html, options) };
}

/** Patterns that indicate potentially dangerous content */
const SUSPICIOUS_PATTERNS: RegExp[] = [
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /expression\s*\(/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
  /\.innerHTML\s*=/i,
  /\.outerHTML\s*=/i,
  /document\s*\./i,
  /window\s*\./i,
  /localStorage/i,
  /sessionStorage/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
];

/**
 * Check whether a string contains patterns that suggest malicious content.
 *
 * Returns `true` if any suspicious pattern is found.
 */
export function isContentSuspicious(content: string): boolean {
  if (!content) return false;
  return SUSPICIOUS_PATTERNS.some(pattern => pattern.test(content));
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
export function sanitizeURL(url: string, opts?: { allowDataUrls?: boolean }): string {
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
