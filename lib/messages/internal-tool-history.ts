const INTERNAL_TOOL_HISTORY_PREFIX = "[Previous ";

const INTERNAL_TOOL_NAME_PATTERNS = [
  /\bread(?:\s|-)?file\b/i,
  /\bedit(?:\s|-)?file\b/i,
  /\bwrite(?:\s|-)?file\b/i,
  /\blocal(?:\s|-)?grep\b/i,
  /\bvector(?:\s|-)?search\b/i,
  /\bexecute(?:\s|-)?command\b/i,
  /\bupdate(?:\s|-)?plan\b/i,
];

const INTERNAL_NAMESPACE_PATTERNS = [
  /\bfunctions\.[a-z]+\b/i,
  /\bonly commentary tools?\b/i,
  /\bactual tools available names\b/i,
  /\bwe already have context\b/i,
  /\bread current files before edit\b/i,
  /\bsequential edits?\b/i,
];

const INTERNAL_DIRECTIVE_PATTERNS = [
  /(?:^|[\n.])\s*(?:i need|need|must|we need|also need|let's)\b/i,
  /\bneed use\b/i,
  /\bmust read\b/i,
  /\bimplement carefully\b/i,
  /\brun tests?\b/i,
  /\blet's read more\b/i,
];

const INTERNAL_CODE_NAVIGATION_PATTERNS = [
  /\binspect around\b/i,
  /\bread lines?\s+\d+/i,
  /\b[a-z0-9/_-]+\.(?:ts|tsx|js|jsx|json|py|go|rs)\b/i,
  /\bfilePath\b/i,
];

function countPatternMatches(value: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(value)) {
      count += 1;
    }
  }
  return count;
}

export function isInternalToolHistoryLeakText(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!trimmed.startsWith(INTERNAL_TOOL_HISTORY_PREFIX)) {
    return false;
  }

  if (!trimmed.includes("call_id=")) {
    return false;
  }

  return (
    trimmed.includes(" result;") ||
    trimmed.includes(" call omitted") ||
    trimmed.includes("result; call_id=") ||
    trimmed.includes("missing output")
  );
}

export function isInternalAssistantLeakText(
  value: unknown,
  options: { hasToolCallLikeParts?: boolean } = {}
): value is string {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (isInternalToolHistoryLeakText(trimmed)) {
    return true;
  }

  if (!options.hasToolCallLikeParts) {
    return false;
  }

  const namespaceMatches = countPatternMatches(trimmed, INTERNAL_NAMESPACE_PATTERNS);
  const toolNameMatches = countPatternMatches(trimmed, INTERNAL_TOOL_NAME_PATTERNS);
  const directiveMatches = countPatternMatches(trimmed, INTERNAL_DIRECTIVE_PATTERNS);
  const codeNavigationMatches = countPatternMatches(trimmed, INTERNAL_CODE_NAVIGATION_PATTERNS);

  if (namespaceMatches > 0 && directiveMatches > 0 && (toolNameMatches > 0 || codeNavigationMatches > 0)) {
    return true;
  }

  return toolNameMatches >= 2 && directiveMatches >= 2 && codeNavigationMatches > 0;
}
