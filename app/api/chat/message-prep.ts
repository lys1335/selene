/**
 * message-prep.ts
 *
 * Prepares messages for the AI streaming request:
 * - Builds refetch tools for tool-result enhancement
 * - Enhances frontend messages with DB tool results
 * - Converts messages to the AI SDK core format
 * - Splits tool-result parts from assistant messages for native Claude providers
 * - Strips stale <environment_details> and injects a fresh block
 */

import type { ModelMessage, UserModelMessage } from "ai";
import {
  createRetrieveFullContentTool,
} from "@/lib/ai/tools";
import { createWebSearchTool } from "@/lib/ai/web-search";
import { createVectorSearchToolV2 } from "@/lib/ai/vector-search";
import { createReadFileTool } from "@/lib/ai/tools/read-file-tool";
import { createLocalGrepTool } from "@/lib/ai/ripgrep";
import { createSendMessageToChannelTool } from "@/lib/ai/tools/channel-tools";
import { createSkillTool } from "@/lib/ai/tools/skill-tool";
import {
  enhanceFrontendMessagesWithToolResults,
  type FrontendMessage,
} from "@/lib/messages/tool-enhancement";
import { splitToolResultsFromAssistantMessages } from "./message-splitter";
import { extractContent } from "./content-extractor";
import { MAX_TOOL_REFETCH } from "./content-sanitizer";
import { getMessages } from "@/lib/db/queries-messages";
import type { DBContentPart } from "@/lib/messages/converter";

// ─── Provider-scoped reasoning re-injection ───────────────────────────────────

/**
 * Providers that require assistant-side `reasoning_content` to round-trip on
 * every follow-up request after a thinking-mode turn. DeepSeek's documented
 * contract: "The `reasoning_content` in the thinking mode must be passed back
 * to the API" — without it the server returns HTTP 400 on the next turn that
 * carries tool results from the same thread.
 *
 * Anthropic's thinking blocks ALSO need to round-trip, but they additionally
 * require a provider-issued `signature` that Selene does not currently capture
 * at the streaming layer — injecting reasoning without a signature breaks
 * requests to Claude. We therefore gate injection to DeepSeek only.
 */
const PROVIDERS_REQUIRING_REASONING_REPLAY = new Set<string>(["deepseek"]);

function collectReasoningTextsFromDbContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const part of content as DBContentPart[]) {
    if (part && (part as { type?: string }).type === "reasoning") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) {
        texts.push(text);
      }
    }
  }
  return texts;
}

/**
 * Re-inject reasoning parts stored on DB assistant messages into the matching
 * frontend messages before `extractContent` converts them to ModelMessages.
 *
 * The UI pipeline strips reasoning parts in `buildUIPartsFromDBContent`, so
 * reasoning never reaches the client. For providers that require
 * `reasoning_content` on replay we restore it here from the authoritative DB
 * copy, matching by stable message ID.
 */
async function injectReasoningFromDbForProvider(
  frontendMessages: FrontendMessage[],
  sessionId: string,
  provider: string | undefined,
): Promise<FrontendMessage[]> {
  if (!provider || !PROVIDERS_REQUIRING_REASONING_REPLAY.has(provider)) {
    return frontendMessages;
  }

  const assistantIdsInRequest = new Set<string>();
  for (const msg of frontendMessages) {
    if (msg.role === "assistant" && typeof msg.id === "string" && msg.id.length > 0) {
      assistantIdsInRequest.add(msg.id);
    }
  }
  if (assistantIdsInRequest.size === 0) {
    return frontendMessages;
  }

  let dbMessages: Array<{ id: string; role: string; content: unknown }>;
  try {
    dbMessages = (await getMessages(sessionId)) as Array<{
      id: string;
      role: string;
      content: unknown;
    }>;
  } catch (error) {
    console.warn(
      `[CHAT API] Failed to fetch DB messages for reasoning re-injection (provider=${provider}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return frontendMessages;
  }

  const reasoningByMessageId = new Map<string, string[]>();
  for (const dbMsg of dbMessages) {
    if (dbMsg.role !== "assistant") continue;
    if (!assistantIdsInRequest.has(dbMsg.id)) continue;
    const texts = collectReasoningTextsFromDbContent(dbMsg.content);
    if (texts.length > 0) {
      reasoningByMessageId.set(dbMsg.id, texts);
    }
  }

  if (reasoningByMessageId.size === 0) {
    return frontendMessages;
  }

  let injectedCount = 0;
  const enhanced = frontendMessages.map((msg) => {
    if (msg.role !== "assistant" || typeof msg.id !== "string") return msg;
    const dbTexts = reasoningByMessageId.get(msg.id);
    if (!dbTexts || dbTexts.length === 0) return msg;

    const existingParts = Array.isArray(msg.parts) ? [...msg.parts] : [];

    // Dedupe: skip reasoning texts already present on the frontend message
    // (handles the case where a future refactor teaches the UI converter to
    // carry reasoning forward — this function then becomes a no-op for those
    // messages rather than duplicating content).
    const existingReasoningTexts = new Set<string>();
    for (const part of existingParts) {
      if (part && part.type === "reasoning" && typeof part.text === "string") {
        existingReasoningTexts.add(part.text);
      }
    }

    const reasoningParts = dbTexts
      .filter((text) => !existingReasoningTexts.has(text))
      .map((text) => ({ type: "reasoning" as const, text }));

    if (reasoningParts.length === 0) return msg;

    injectedCount += reasoningParts.length;
    // Prepend reasoning so the canonical shape is [reasoning..., text/tool-call...].
    return { ...msg, parts: [...reasoningParts, ...existingParts] };
  });

  if (injectedCount > 0) {
    console.log(
      `[CHAT API] Re-injected ${injectedCount} reasoning part(s) from DB for provider=${provider} ` +
        `across ${reasoningByMessageId.size} assistant message(s).`,
    );
  }

  return enhanced;
}

// ─── Public interface ─────────────────────────────────────────────────────────

interface MessagePrepArgs {
  messages: FrontendMessage[];
  sessionId: string;
  userId: string;
  characterId: string | null;
  sessionMetadata: Record<string, unknown>;
  currentModelId: string | undefined;
  currentProvider: string | undefined;
  sessionSummary?: string | null;
}

interface MessagePrepResult {
  coreMessages: ModelMessage[];
  enhancedMessages: FrontendMessage[];
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function prepareMessagesForRequest(
  args: MessagePrepArgs
): Promise<MessagePrepResult> {
  const {
    messages,
    sessionId,
    userId,
    characterId,
    sessionMetadata,
    currentModelId,
    currentProvider,
    sessionSummary,
  } = args;

  // Build refetch tools for enhanceFrontendMessagesWithToolResults
  const refetchTools = {
    sendMessageToChannel: createSendMessageToChannelTool({
      sessionId,
      userId,
      sessionMetadata,
    }),
    readFile: createReadFileTool({
      sessionId,
      userId,
      characterId: characterId || null,
    }),
    localGrep: createLocalGrepTool({
      sessionId,
      characterId: characterId || null,
    }),
    vectorSearch: createVectorSearchToolV2({
      sessionId,
      userId,
      characterId: characterId || null,
      sessionMetadata,
    }),
    webSearch: createWebSearchTool({
      sessionId,
      userId,
      characterId: characterId || null,
    }),
    retrieveFullContent: createRetrieveFullContentTool({ sessionId }),
    skill: createSkillTool({
      sessionId,
      userId,
      characterId: characterId || "",
    }),
  };

  // Enhance frontend messages with tool results from database
  let enhancedMessages = await enhanceFrontendMessagesWithToolResults(
    messages,
    sessionId,
    {
      refetchTools,
      maxRefetch: MAX_TOOL_REFETCH,
    }
  );

  console.log(
    `[CHAT API] Enhanced ${enhancedMessages.length} messages with DB tool results`
  );

  // Providers with mandatory reasoning replay (DeepSeek thinking mode) require
  // `reasoning_content` on every follow-up request. The UI pipeline strips
  // reasoning parts, so we restore them from the DB here before extraction.
  enhancedMessages = await injectReasoningFromDbForProvider(
    enhancedMessages,
    sessionId,
    currentProvider,
  );

  // Convert to core format for the AI SDK
  let coreMessages: ModelMessage[] = await Promise.all(
    enhancedMessages.map(async (msg, idx) => {
      const content = await extractContent(
        msg as Parameters<typeof extractContent>[0],
        true, // includeUrlHelpers
        true, // convertUserImagesToBase64
        sessionId
      );
      console.log(
        `[CHAT API] Message ${idx} (${msg.role}):`,
        JSON.stringify(
          {
            hasParts: !!(msg as { parts?: unknown[] }).parts,
            partsCount: (msg as { parts?: unknown[] }).parts?.length,
            partTypes: (
              msg as { parts?: Array<{ type: string }> }
            ).parts?.map((p) => p.type),
            contentType:
              typeof content === "string" ? "string" : "array",
            contentLength:
              typeof content === "string"
                ? content.length
                : (content as unknown[]).length,
            contentPreview:
              Array.isArray(content)
                ? (content as Array<{ type: string; image?: string; text?: string }>).map((part) => ({
                    type: part.type,
                    hasImage: typeof part.image === "string",
                    imagePreview:
                      typeof part.image === "string"
                        ? part.image.slice(0, 80)
                        : undefined,
                    textPreview:
                      typeof part.text === "string"
                        ? part.text.slice(0, 120)
                        : undefined,
                  }))
                : typeof content === "string"
                  ? content.slice(0, 200)
                  : null,
          },
          null,
          2
        )
      );
      return {
        role: msg.role as "user" | "assistant" | "system",
        content,
      } as ModelMessage;
    })
  );

  // Split tool-result parts from assistant messages into separate role:"tool"
  // messages. Both Anthropic and OpenAI APIs require tool results as distinct
  // messages — the AI SDK OpenAI converter silently drops tool-result parts
  // that remain inline in assistant messages, causing "Tool results are missing"
  // errors on follow-up turns.
  coreMessages = splitToolResultsFromAssistantMessages(coreMessages);

  if (sessionSummary?.trim()) {
    coreMessages = [
      {
        role: "system",
        content: `Previous conversation summary:\n${sessionSummary.trim()}`,
      },
      ...coreMessages,
    ];
  }

  // Log coreMessages structure after all sanitization
  console.log(
    `[CHAT API] Final coreMessages (${coreMessages.length} messages) before streamText:`
  );
  coreMessages.forEach((msg, idx) => {
    if (typeof msg.content === "string") {
      console.log(
        `  [${idx}] role=${msg.role}, content=string(${msg.content.length})`
      );
    } else if (Array.isArray(msg.content)) {
      const types = (
        msg.content as Array<{ type: string; toolCallId?: string; image?: string; mediaType?: string }>
      ).map((p) => {
        const suffix = p.toolCallId
          ? `:${p.toolCallId}`
          : p.type === "image"
            ? ":image"
            : p.type === "file" && typeof p.mediaType === "string"
              ? `:${p.mediaType}`
              : "";
        return p.type + suffix;
      });
      console.log(
        `  [${idx}] role=${msg.role}, parts=[${types.join(", ")}]`
      );
      if (msg.role === "user") {
        console.log(
          `  [${idx}] userContentDetail=${JSON.stringify(
            (msg.content as Array<{ type: string; image?: string; text?: string; mediaType?: string }>).map((part) => ({
              type: part.type,
              mediaType: part.mediaType,
              imagePreview:
                typeof part.image === "string" ? part.image.slice(0, 120) : undefined,
              textPreview:
                typeof part.text === "string" ? part.text.slice(0, 120) : undefined,
            })),
          )}`
        );
      }
    }
  });

  // Validate tool call inputs before sending to AI SDK
  coreMessages.forEach((msg, idx) => {
    if (Array.isArray(msg.content)) {
      msg.content.forEach((part: any, partIdx) => {
        if (part.type === "tool-use" && part.input !== undefined) {
          if (typeof part.input === "string") {
            try {
              JSON.parse(part.input);
              console.warn(
                `[CHAT API] Tool input at message ${idx}, part ${partIdx} is a JSON string instead of object. ` +
                  `This may cause API errors. Tool: ${part.toolName}`
              );
            } catch (e) {
              console.error(
                `[CHAT API] Invalid tool input at message ${idx}, part ${partIdx}: ` +
                  `Tool: ${part.toolName}, Input: ${part.input
                    ?.toString()
                    .substring(0, 100)}`
              );
            }
          }
        }
      });
    }
  });

  // ── Environment details injection ──────────────────────────────────────────
  // Strip stale <environment_details> from all user messages, then inject a
  // fresh block with current server time + user timezone into the last user message.
  const envDetailsRegex =
    /\n*<environment_details>[\s\S]*?<\/environment_details>/g;

  function stripEnvDetails(userMsg: UserModelMessage): UserModelMessage {
    if (typeof userMsg.content === "string") {
      return {
        ...userMsg,
        content: userMsg.content.replace(envDetailsRegex, ""),
      };
    }
    return {
      ...userMsg,
      content: userMsg.content.map((part) =>
        part.type === "text"
          ? { ...part, text: part.text.replace(envDetailsRegex, "") }
          : part
      ),
    };
  }

  for (let i = 0; i < coreMessages.length; i++) {
    const msg = coreMessages[i];
    if (msg.role !== "user") continue;
    coreMessages[i] = stripEnvDetails(msg);
  }

  // Inject fresh environment_details into the last user message
  {
    const envNow = new Date();
    const userTz = (sessionMetadata?.userTimezone as string) || null;
    const tzOffset = userTz
      ? (() => {
          try {
            const fmt = new Intl.DateTimeFormat("en", {
              timeZone: userTz,
              timeZoneName: "shortOffset",
            });
            const offset =
              fmt
                .formatToParts(envNow)
                .find((p) => p.type === "timeZoneName")?.value || "";
            return offset.replace("GMT", "UTC");
          } catch {
            return "";
          }
        })()
      : "";
    const envBlock =
      `\n\n<environment_details>\nCurrent time: ${envNow.toISOString()}` +
      (userTz ? `\nUser timezone: ${userTz}, ${tzOffset}` : "") +
      `\n</environment_details>`;

    const lastUserIdx = coreMessages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx !== -1) {
      const msg = coreMessages[lastUserIdx];
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          coreMessages[lastUserIdx] = {
            ...msg,
            content: msg.content + envBlock,
          };
        } else {
          coreMessages[lastUserIdx] = {
            ...msg,
            content: [
              ...msg.content,
              { type: "text" as const, text: envBlock },
            ],
          };
        }
      }
    }
  }

  return { coreMessages, enhancedMessages };
}
