import { estimateTokens, CHARS_PER_TOKEN } from "@/lib/ai/output-limiter";
import { middleTruncateText } from "@/lib/ai/truncation-utils";

const MIN_STREAM_TOOL_RESULT_TOKENS = 1;
export const MAX_STREAM_TOOL_RESULT_TOKENS = 25_000;

interface GuardToolResultForStreamingResult {
  blocked: boolean;
  estimatedTokens: number;
  result: unknown;
}

interface GuardToolResultForStreamingOptions {
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function estimateTokensSafely(content: unknown): number {
  try {
    return estimateTokens(content);
  } catch {
    const fallback = typeof content === "string" ? content : safeStringify(content);
    return Math.ceil(fallback.length / 4);
  }
}

function normalizeTokenLimit(maxTokens?: number): number {
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens)) {
    return MAX_STREAM_TOOL_RESULT_TOKENS;
  }

  const normalized = Math.max(MIN_STREAM_TOOL_RESULT_TOKENS, Math.floor(maxTokens));
  return Math.min(normalized, MAX_STREAM_TOOL_RESULT_TOKENS);
}

function extractRetrievalIds(result: unknown): {
  logId?: string;
  truncatedContentId?: string;
} {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {};
  }

  const record = result as Record<string, unknown>;
  const logId = typeof record.logId === "string" ? record.logId : undefined;
  const truncatedContentId =
    typeof record.truncatedContentId === "string" ? record.truncatedContentId : undefined;

  return {
    logId,
    truncatedContentId,
  };
}

/**
 * Build a retrieval notice appended to truncated content so the model
 * knows how to get the full output.
 */
function buildRetrievalNotice(
  estimatedTokens: number,
  tokenLimit: number,
  retrieval: { logId?: string; truncatedContentId?: string }
): string {
  let notice = `\n[OUTPUT TRUNCATED: ~${estimatedTokens.toLocaleString()} tokens → ~${tokenLimit.toLocaleString()} tokens (head + tail preserved).`;

  if (retrieval.logId) {
    notice += ` Full output: executeCommand({ command: "readLog", logId: "${retrieval.logId}" })`;
  } else if (retrieval.truncatedContentId) {
    notice += ` Full output: retrieveFullContent({ contentId: "${retrieval.truncatedContentId}" })`;
  }

  notice += "]";
  return notice;
}

/**
 * Truncate the text content of a tool result to fit within a character budget.
 * Preserves the result structure (stdout/stderr, MCP content arrays, generic text fields)
 * while applying head+tail middle-truncation to the text.
 */
function truncateResultText(
  result: unknown,
  maxChars: number
): { result: unknown; truncated: boolean } {
  // String results
  if (typeof result === "string") {
    const t = middleTruncateText(result, maxChars);
    return { result: t.content, truncated: t.truncated };
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { result, truncated: false };
  }

  const obj = { ...(result as Record<string, unknown>) };
  let truncated = false;

  // stdout/stderr — most common oversized case (executeCommand)
  if (typeof obj.stdout === "string" || typeof obj.stderr === "string") {
    if (typeof obj.stdout === "string") {
      // Give 85% of budget to stdout, 15% to stderr (stdout is usually the bulk)
      const budget = typeof obj.stderr === "string" ? Math.floor(maxChars * 0.85) : maxChars;
      const t = middleTruncateText(obj.stdout as string, budget);
      obj.stdout = t.content;
      truncated = truncated || t.truncated;
    }
    if (typeof obj.stderr === "string") {
      const budget = typeof obj.stdout === "string" ? Math.floor(maxChars * 0.15) : maxChars;
      const t = middleTruncateText(obj.stderr as string, budget);
      obj.stderr = t.content;
      truncated = truncated || t.truncated;
    }
    if (truncated) obj.isTruncated = true;
    return { result: obj, truncated };
  }

  // MCP content arrays: { content: [{ type: "text", text: "..." }, ...] }
  if (Array.isArray(obj.content)) {
    const items = obj.content as unknown[];
    const textItems = items.filter(
      (i: any) => i?.type === "text" && typeof i?.text === "string"
    );
    if (textItems.length > 0) {
      const budgetPerItem = Math.floor(maxChars / textItems.length);
      obj.content = items.map((item: any) => {
        if (item?.type === "text" && typeof item?.text === "string") {
          const t = middleTruncateText(item.text, budgetPerItem);
          truncated = truncated || t.truncated;
          return { ...item, text: t.content };
        }
        return item;
      });
      if (truncated) obj.isTruncated = true;
      return { result: obj, truncated };
    }
  }

  // Generic text fields (content, text, result, output)
  for (const field of ["content", "text", "result", "output"]) {
    if (typeof obj[field] === "string" && (obj[field] as string).length > maxChars) {
      const t = middleTruncateText(obj[field] as string, maxChars);
      obj[field] = t.content;
      truncated = truncated || t.truncated;
      if (truncated) {
        obj.isTruncated = true;
        return { result: obj, truncated };
      }
    }
  }

  // Last resort: serialize the whole object and truncate
  const serialized = safeStringify(result);
  if (serialized.length > maxChars) {
    const t = middleTruncateText(serialized, maxChars);
    return { result: t.content, truncated: true };
  }

  return { result, truncated: false };
}

/**
 * Guard tool results for streaming by truncating oversized output.
 *
 * Instead of replacing oversized results with an error, this applies
 * head+tail middle-truncation to preserve the beginning (setup, context)
 * and end (results, errors, exit status) of the output.
 */
export function guardToolResultForStreaming(
  toolName: string,
  result: unknown,
  options: GuardToolResultForStreamingOptions = {}
): GuardToolResultForStreamingResult {
  const estimatedTokens = estimateTokensSafely(result);
  const tokenLimit = normalizeTokenLimit(options.maxTokens);

  if (estimatedTokens <= tokenLimit) {
    return {
      blocked: false,
      estimatedTokens,
      result,
    };
  }

  // Oversized — truncate with head+tail instead of blocking entirely.
  // Reserve tokens for the retrieval notice and structural metadata.
  const METADATA_RESERVE_TOKENS = 500;
  const contentBudgetTokens = Math.max(500, tokenLimit - METADATA_RESERVE_TOKENS);
  const contentBudgetChars = contentBudgetTokens * CHARS_PER_TOKEN;

  const { result: truncatedResult, truncated } = truncateResultText(result, contentBudgetChars);

  if (!truncated) {
    // Edge case: couldn't find text to truncate but token estimate says it's oversized.
    // This shouldn't normally happen, but fall back gracefully.
    return {
      blocked: true,
      estimatedTokens,
      result: truncatedResult,
    };
  }

  // Add retrieval notice so the model knows how to get full output
  const retrieval = extractRetrievalIds(result);
  const notice = buildRetrievalNotice(estimatedTokens, tokenLimit, retrieval);

  // Append notice to the truncated result
  let finalResult = truncatedResult;
  if (typeof finalResult === "string") {
    finalResult = finalResult + notice;
  } else if (finalResult && typeof finalResult === "object" && !Array.isArray(finalResult)) {
    const obj = finalResult as Record<string, unknown>;
    // Append to stdout (executeCommand) or first text field
    if (typeof obj.stdout === "string") {
      obj.stdout = (obj.stdout as string) + notice;
    } else if (typeof obj.content === "string") {
      obj.content = (obj.content as string) + notice;
    } else if (typeof obj.text === "string") {
      obj.text = (obj.text as string) + notice;
    }
    finalResult = obj;
  }

  return {
    blocked: true, // Still flagged for loop guard tracking
    estimatedTokens,
    result: finalResult,
  };
}
