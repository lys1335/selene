/**
 * streaming-progress.ts
 *
 * Factory for the `syncStreamingMessage` function used inside the POST handler.
 * This function persists the current streaming state to the database and emits
 * progress events to the background-task registry.
 */

import { createMessage, updateMessage } from "@/lib/db/queries";
import { taskRegistry } from "@/lib/background-tasks/registry";
import { limitProgressContent } from "@/lib/background-tasks/progress-content-limiter";
import { nextOrderingIndex } from "@/lib/session/message-ordering";
import { nowISO } from "@/lib/utils/timestamp";
import type { DBContentPart, DBToolCallPart } from "@/lib/messages/converter";
import {
  type StreamingMessageState,
  cloneContentParts,
  buildProgressSignature,
  extractTextFromParts,
} from "./streaming-state";
import { INTERACTIVE_TOOL_NAME_SET } from "@/lib/interactive-tools/constants";

function collectPersistedToolResultIds(parts: DBContentPart[]): Set<string> {
  const persistedToolResultIds = new Set<string>();
  for (const part of parts) {
    if (part.type === "tool-result" && typeof part.toolCallId === "string") {
      persistedToolResultIds.add(part.toolCallId);
    }
  }
  return persistedToolResultIds;
}

function emitDroppedToolCallTelemetry(
  streamingState: StreamingMessageState,
  part: DBToolCallPart,
  reason: "input-streaming" | "malformed-args" | "unresolved-no-result",
  persistedToolResultIds: Set<string>
): void {
  const toolCallId = part.toolCallId || "unknown-tool-call";
  const toolName = part.toolName || "tool";
  const logKey = `drop:${reason}:${toolCallId}`;
  if (streamingState.loggedIncompleteToolCalls.has(logKey)) {
    return;
  }
  streamingState.loggedIncompleteToolCalls.add(logKey);

  console.warn("[CHAT API] Dropped unresolved projected tool call", {
    toolCallId,
    toolName,
    reason,
    state: part.state,
    hasArgs: part.args !== undefined,
    hasArgsText: typeof part.argsText === "string" && part.argsText.length > 0,
    argsTextLength: typeof part.argsText === "string" ? part.argsText.length : 0,
    hasResultPart: persistedToolResultIds.has(toolCallId),
    projection: "streaming-persistence",
  });
}

/**
 * Tool names that block SDK execution while waiting for user input.
 * These must be persisted to the DB even without a matching tool-result,
 * otherwise they vanish from the chat when the client reloads from DB
 * (background mode). See: https://github.com/seline/seline/issues/XXX
 */
const INTERACTIVE_TOOL_NAMES = INTERACTIVE_TOOL_NAME_SET;

export function filterStreamingPartsForPersistence(
  streamingState: StreamingMessageState
): DBContentPart[] {
  const persistedToolResultIds = collectPersistedToolResultIds(streamingState.parts);

  return streamingState.parts.filter((part) => {
    if (part.type !== "tool-call") {
      return true;
    }

    const hasCompleteArgs = part.args !== undefined;
    const isStillStreaming = part.state === "input-streaming";

    // Interactive tools (AskUserQuestion, ExitPlanMode, AskFollowupQuestion) block
    // the SDK while waiting for user input. The SDK fires PreToolUse *before*
    // emitting content_block_stop, so args may not be complete yet when
    // filterStreamingPartsForPersistence is first called. We must persist them
    // early — as long as there's any argument content — so the UI shows the
    // pending question while the user is deciding. The non-result check below
    // is intentionally skipped for these tools.
    if (INTERACTIVE_TOOL_NAMES.has(part.toolName)) {
      const hasArgContent =
        hasCompleteArgs ||
        (typeof part.argsText === "string" && part.argsText.length > 0);
      if (hasArgContent) return true;
      // Nothing to render yet (streaming just started) — suppress until content arrives.
      return false;
    }

    if (isStillStreaming && !hasCompleteArgs) {
      emitDroppedToolCallTelemetry(streamingState, part, "input-streaming", persistedToolResultIds);
      return false;
    }

    if (!hasCompleteArgs && part.argsText) {
      try {
        JSON.parse(part.argsText);
      } catch {
        emitDroppedToolCallTelemetry(streamingState, part, "malformed-args", persistedToolResultIds);
        return false;
      }
    }

    if (!persistedToolResultIds.has(part.toolCallId)) {
      emitDroppedToolCallTelemetry(
        streamingState,
        part,
        "unresolved-no-result",
        persistedToolResultIds,
      );
      return false;
    }

    return true;
  });
}

export function buildProgressContentSnapshot(
  streamingState: StreamingMessageState,
  persistedParts: DBContentPart[]
): DBContentPart[] {
  const persistedToolResultIds = collectPersistedToolResultIds(streamingState.parts);

  return streamingState.parts.map((part) => {
    if (part.type !== "tool-call") {
      return part;
    }

    const isResolved = persistedToolResultIds.has(part.toolCallId);
    if (isResolved) {
      return part;
    }

    const progressPart: DBToolCallPart = {
      ...part,
      active: true,
    };

    return progressPart;
  }).filter((part) => {
    if (part.type !== "tool-call") {
      return true;
    }

    if ((part as DBToolCallPart).active === true) {
      return true;
    }

    return persistedParts.some(
      (candidate) => candidate.type === "tool-call" && candidate.toolCallId === part.toolCallId
    );
  });
}

// Progress content limiter is now ON by default. Set env to "true" to disable.
const DISABLE_PROGRESS_CONTENT_LIMITER =
  process.env.DISABLE_PROGRESS_CONTENT_LIMITER === "true";

export interface SyncStreamingMessageContext {
  sessionId: string;
  userId: string;
  eventCharacterId: string;
  scheduledRunId: string | null;
  scheduledTaskId: string | null;
  scheduledTaskName: string | null;
  /** Reference to the current agentRun — may be set after factory is called. */
  getAgentRunId: () => string | undefined;
  streamingState: StreamingMessageState;
  /**
   * Returns the assistant UUID that should be used when the next streaming DB
   * record is created. This allows live-prompt splits to rotate the frontend/DB
   * message ID so post-injection assistant segments do not reuse the original ID.
   */
  getAssistantMessageId?: () => string | undefined;
}

/**
 * Creates the `syncStreamingMessage(force?)` function.
 * The returned function is self-referencing (for deferred setTimeout calls),
 * so the factory returns the function directly rather than via an object.
 */
export function createSyncStreamingMessage(
  ctx: SyncStreamingMessageContext
): (force?: boolean) => Promise<void> {
  const {
    sessionId,
    userId,
    eventCharacterId,
    scheduledRunId,
    scheduledTaskId,
    scheduledTaskName,
    getAgentRunId,
    streamingState,
    getAssistantMessageId,
  } = ctx;

  const syncStreamingMessage = async (force = false): Promise<void> => {
    if (streamingState.parts.length === 0) return;

    let filteredParts = filterStreamingPartsForPersistence(streamingState);

    if (filteredParts.length === 0 && streamingState.parts.length > 0) {
      filteredParts = [{ type: "text", text: "Working..." }];
    }

    const now = Date.now();
    const signature = buildProgressSignature(filteredParts);
    if (signature === streamingState.lastBroadcastSignature) return;

    if (!force) {
      const timeSinceLastBroadcast = now - streamingState.lastBroadcastAt;
      const hasToolChanges = filteredParts.some(
        (part) => part.type === "tool-call" || part.type === "tool-result"
      );
      const throttleInterval = hasToolChanges ? 400 : 200;
      if (timeSinceLastBroadcast < throttleInterval) {
        if (!streamingState.pendingBroadcast) {
          streamingState.pendingBroadcast = true;
          setTimeout(() => {
            if (streamingState.pendingBroadcast) {
              streamingState.pendingBroadcast = false;
              void syncStreamingMessage();
            }
          }, throttleInterval - timeSinceLastBroadcast);
        }
        return;
      }
    }

    streamingState.pendingBroadcast = false;
    const partsSnapshot = cloneContentParts(filteredParts);

    if (!streamingState.messageId) {
      if (streamingState.isCreating) return;
      streamingState.isCreating = true;
      try {
        const assistantMessageIndex = await nextOrderingIndex(sessionId);
        const assistantMessageId = getAssistantMessageId?.();
        const created = await createMessage({
          ...(assistantMessageId ? { id: assistantMessageId } : {}),
          sessionId,
          role: "assistant",
          content: partsSnapshot,
          orderingIndex: assistantMessageIndex,
          metadata: { isStreaming: true, scheduledRunId, scheduledTaskId },
        });
        streamingState.messageId = created?.id;
      } finally {
        streamingState.isCreating = false;
      }
    } else {
      await updateMessage(streamingState.messageId, { content: partsSnapshot });
    }

    if (streamingState.messageId) {
      streamingState.lastBroadcastSignature = signature;
      streamingState.lastBroadcastAt = now;
      let progressText = extractTextFromParts(partsSnapshot);
      if (!progressText) {
        for (let index = streamingState.parts.length - 1; index >= 0; index -= 1) {
          const part = streamingState.parts[index];
          if (part?.type === "tool-call") {
            progressText = `Running ${part.toolName || "tool"}...`;
            break;
          }
        }
      }
      if (!progressText) progressText = "Working...";

      const agentRunId = getAgentRunId();
      const progressRunId = scheduledRunId ?? agentRunId;
      const progressType = scheduledRunId ? "scheduled" : agentRunId ? "chat" : undefined;
      const assistantMessageId = streamingState.messageId;

      console.log("[CHAT API] Progress event routing:", {
        scheduledRunId,
        agentRunId,
        progressRunId,
        progressType,
        assistantMessageId,
        progressText: progressText.slice(0, 50),
        willEmitToRegistry: Boolean(progressRunId && progressType),
      });

      if (progressRunId && progressType) {
        const progressSnapshot = buildProgressContentSnapshot(streamingState, partsSnapshot);

        // Strip argsText from tool-call parts before progress emission.
        // argsText is only needed for finalization, not for display, and can
        // be hundreds of KB from runaway model outputs.
        const strippedSnapshot = progressSnapshot.map((part) => {
          if (part.type === "tool-call" && "argsText" in part) {
            const { argsText: _strip, ...rest } = part as unknown as Record<string, unknown>;
            return rest as unknown as DBContentPart;
          }
          return part;
        });

        const progressLimit = DISABLE_PROGRESS_CONTENT_LIMITER
          ? null
          : limitProgressContent(strippedSnapshot);
        if (progressLimit?.wasTruncated) {
          console.log(
            `[CHAT API] Progress content truncated: ` +
              `~${progressLimit.originalTokens.toLocaleString()} -> ~${progressLimit.finalTokens.toLocaleString()} tokens` +
              (progressLimit.hardCapped ? " (hard cap summary applied)" : "")
          );
        }
        taskRegistry.emitProgress(progressRunId, progressText, undefined, {
          type: progressType,
          taskId: scheduledTaskId ?? undefined,
          taskName: scheduledTaskName ?? undefined,
          userId,
          characterId: eventCharacterId,
          sessionId,
          assistantMessageId,
          progressContent: (progressLimit?.content ?? strippedSnapshot) as DBContentPart[],
          progressContentLimited: progressLimit?.wasTruncated,
          progressContentOriginalTokens: progressLimit?.originalTokens,
          progressContentFinalTokens: progressLimit?.finalTokens,
          progressContentTruncatedParts: progressLimit?.truncatedParts,
          progressContentProjectionOnly: true,
          startedAt: nowISO(),
        });
      }
    }
  };

  return syncStreamingMessage;
}
