/**
 * Context Status API Endpoint
 *
 * Returns the current context window status for a session.
 * Used by the UI to display context usage indicators.
 *
 * GET /api/sessions/[id]/context-status
 *
 * @returns {
 *   percentage: number;      // Usage percentage (0-100)
 *   status: string;          // "safe" | "warning" | "critical" | "exceeded"
 *   currentTokens: number;   // Current token count
 *   maxTokens: number;       // Maximum tokens for the model
 *   formatted: {
 *     current: string;       // e.g., "150.2K"
 *     max: string;           // e.g., "200K"
 *     percentage: string;    // e.g., "75.1%"
 *   };
 *   thresholds: {
 *     warning: number;
 *     critical: number;
 *     hardLimit: number;
 *   };
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { ContextWindowManager } from "@/lib/context-window";
import { getSession } from "@/lib/db/queries";
import { requireAuth } from "@/lib/auth/local-auth";
import { getSessionModelIdForSession, getSessionProviderForSession, extractSessionModelConfig } from "@/lib/ai/session-model-resolver";
import { ensureKimiTokenValid, ensureAntigravityTokenValid, ensureClaudeCodeTokenValid, ensureCodexTokenValid } from "@/lib/ai/providers";
import type { LLMProvider } from "@/lib/ai/provider-types";
import { loadSettings } from "@/lib/settings/settings-manager";

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Ensure OAuth tokens are fresh before resolving the session model.
 *
 * The session-model-resolver uses the synchronous `isProviderOperational()`
 * which checks token validity without refreshing.  If a token has expired
 * but is refreshable, the resolver would incorrectly mark the provider as
 * unavailable and fall back to Anthropic.  The chat route already does this
 * pre-flight refresh — this mirrors that behavior for the context-status
 * read path so the model badge reflects the real active model.
 */
async function ensureOAuthTokensFresh(sessionMetadata: Record<string, unknown>): Promise<void> {
  const sessionConfig = extractSessionModelConfig(sessionMetadata);
  const settings = loadSettings();
  // Determine which provider the session intends to use (before fallback logic).
  const intendedProvider: LLMProvider | undefined =
    sessionConfig?.sessionProvider || settings.llmProvider;

  // Only refresh the token for the provider that will actually be evaluated.
  // This keeps the context-status path fast — no unnecessary network calls.
  switch (intendedProvider) {
    case "kimi":
      await ensureKimiTokenValid().catch(() => {});
      break;
    case "antigravity":
      await ensureAntigravityTokenValid().catch(() => {});
      break;
    case "claudecode":
      await ensureClaudeCodeTokenValid().catch(() => {});
      break;
    case "codex":
      await ensureCodexTokenValid().catch(() => {});
      break;
    // anthropic, openrouter, minimax, blackboxai, ollama, vllm — no OAuth tokens to refresh
  }
}

async function resolveSessionModel(
  request: NextRequest,
  params: Promise<{ id: string }>
): Promise<{ sessionId: string; modelId: string; provider: LLMProvider } | NextResponse> {
  await requireAuth(request);
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const sessionMetadata = (session.metadata as Record<string, unknown>) || {};

  // Refresh OAuth tokens before the synchronous availability check in the resolver.
  await ensureOAuthTokensFresh(sessionMetadata);

  const modelId = await getSessionModelIdForSession(sessionMetadata);
  const provider = await getSessionProviderForSession(sessionMetadata);

  return { sessionId, modelId, provider };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolved = await resolveSessionModel(request, params);
    if (resolved instanceof NextResponse) return resolved;
    const { sessionId, modelId, provider } = resolved;

    // Estimate system prompt length (approximate)
    const estimatedSystemPromptLength = 5000;

    // Get context window status
    const status = await ContextWindowManager.checkContextWindow(
      sessionId,
      modelId,
      estimatedSystemPromptLength,
      provider
    );

    return NextResponse.json({
      percentage: status.usagePercentage * 100,
      status: status.status,
      currentTokens: status.currentTokens,
      maxTokens: status.maxTokens,
      formatted: status.formatted,
      thresholds: status.thresholds,
      shouldCompact: status.shouldCompact,
      mustCompact: status.mustCompact,
      recommendedAction: status.recommendedAction,
      model: {
        id: modelId,
        provider,
      },
    });
  } catch (error) {
    console.error("[Context Status API] Error:", error);
    return NextResponse.json(
      { error: "Failed to get context status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sessions/[id]/context-status
 *
 * Trigger manual compaction for a session.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolved = await resolveSessionModel(request, params);
    if (resolved instanceof NextResponse) return resolved;
    const { sessionId, modelId, provider } = resolved;

    // Estimate system prompt length
    const estimatedSystemPromptLength = 5000;

    // Force compaction (aggressive — used by /compact command and UI button)
    const result = await ContextWindowManager.forceCompact(
      sessionId,
      modelId,
      estimatedSystemPromptLength,
      provider
    );

    return NextResponse.json({
      success: result.success,
      compacted: result.success,
      tokensFreed: result.compactionResult.tokensFreed,
      messagesCompacted: result.compactionResult.messagesCompacted,
      before: {
        percentage: result.beforeStatus.usagePercentage * 100,
        status: result.beforeStatus.status,
        currentTokens: result.beforeStatus.currentTokens,
        formatted: result.beforeStatus.formatted,
      },
      status: {
        percentage: result.afterStatus.usagePercentage * 100,
        status: result.afterStatus.status,
        currentTokens: result.afterStatus.currentTokens,
        maxTokens: result.afterStatus.maxTokens,
        formatted: result.afterStatus.formatted,
      },
    });
  } catch (error) {
    console.error("[Context Status API] Compaction error:", error);
    return NextResponse.json(
      { error: "Failed to compact session" },
      { status: 500 }
    );
  }
}
