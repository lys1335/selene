import { describe, expect, it } from "vitest";

import { convertDBMessagesToUIMessages, convertToThreadMessageLike } from "@/lib/messages/converter";
import { isInternalToolHistoryLeakText } from "@/lib/messages/internal-tool-history";

describe("converter internal tool history guard", () => {
  it("hides leaked internal tool fallback assistant text while preserving real tool parts", () => {
    const leakedText =
      '[Previous tool result; call_id=call_legacy]: {"status":"success","stdout":"..." }';
    const now = new Date().toISOString();

    const uiMessages = convertDBMessagesToUIMessages([
      {
        id: "u1",
        role: "user",
        content: [{ type: "text", text: leakedText }],
        createdAt: now,
        orderingIndex: 1,
      },
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "text", text: leakedText },
          {
            type: "tool-call",
            toolCallId: "call_legacy",
            toolName: "localGrep",
            args: { pattern: "x" },
            state: "input-available",
          },
          {
            type: "tool-result",
            toolCallId: "call_legacy",
            toolName: "localGrep",
            result: { status: "success", matchCount: 1 },
            status: "success",
            state: "output-available",
          },
        ],
        createdAt: now,
        orderingIndex: 2,
      },
    ] as any);

    expect(uiMessages).toHaveLength(2);

    const user = uiMessages.find((msg) => msg.role === "user");
    const assistant = uiMessages.find((msg) => msg.role === "assistant");

    const userTextParts = (user?.parts ?? []).filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof (part as { text?: unknown }).text === "string"
    );
    expect(userTextParts[0]?.text).toContain("[Previous tool result;");

    const assistantTextParts = (assistant?.parts ?? []).filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof (part as { text?: unknown }).text === "string"
    );
    expect(assistantTextParts.some((part) => isInternalToolHistoryLeakText(part.text))).toBe(false);

    const assistantToolParts = (assistant?.parts ?? []).filter(
      (part) => typeof part.type === "string" && part.type.startsWith("tool-")
    );
    expect(assistantToolParts.length).toBeGreaterThan(0);
  });

  // Fixture-based test removed: docs/dev/auth-and-vector-engine-audit-162c03ba.json
  // was cleaned up in repo cleanup (6b474e5). The inline test above covers the
  // same converter guard logic without depending on an external fixture file.

  it("keeps assistant messages as empty placeholders when all parts are sanitized", () => {
    const now = new Date().toISOString();

    const uiMessages = convertDBMessagesToUIMessages([
      {
        id: "a-empty",
        role: "assistant",
        content: [
          {
            type: "text",
            text: '[Previous tool result; call_id=call_1]: {"status":"success"}',
          },
        ],
        createdAt: now,
        orderingIndex: 1,
      },
    ] as any);

    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0]?.role).toBe("assistant");

    const textParts = (uiMessages[0]?.parts ?? []).filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof (part as { text?: unknown }).text === "string"
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0]?.text).toBe("");
  });

  it("preserves attachment filenames across DB to UI and thread rehydration", () => {
    const now = new Date().toISOString();
    const filename = "Screenshot 2026-02-10 at 11.05.48\u202fAM (1).png";

    const uiMessages = convertDBMessagesToUIMessages([
      {
        id: "u-attachment",
        role: "user",
        content: [
          {
            type: "file",
            url: "/api/media/sessions/sess-1/uploads/screenshot.png",
            filename,
            mediaType: "image/png",
          },
        ],
        createdAt: now,
        orderingIndex: 1,
      },
    ] as any);

    expect(uiMessages).toHaveLength(1);
    const filePart = (uiMessages[0]?.parts ?? []).find(
      (part): part is { type: "file"; url: string; filename?: string; mediaType?: string } => part.type === "file"
    );
    expect(filePart?.filename).toBe(filename);
    expect(filePart?.mediaType).toBe("image/png");

    const threadMessages = convertToThreadMessageLike(uiMessages as any);
    expect(threadMessages).toHaveLength(1);
    expect(threadMessages[0]?.content).toEqual([
      {
        type: "file",
        url: "/api/media/sessions/sess-1/uploads/screenshot.png",
        filename,
        mediaType: "image/png",
      },
    ]);
  });

  it("preserves unresolved pending tool calls through DB to UI conversion", () => {
    const now = new Date().toISOString();

    const uiMessages = convertDBMessagesToUIMessages([
      {
        id: "a-pending",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-pending",
            toolName: "delegateToSubagent",
            args: { action: "start", agentName: "Reviewer" },
            state: "input-available",
            active: true,
          },
        ],
        createdAt: now,
        orderingIndex: 1,
      },
    ] as any);

    expect(uiMessages).toHaveLength(1);
    const toolPart = uiMessages[0]?.parts.find(
      (part: any) => part.toolCallId === "call-pending"
    ) as any;
    expect(toolPart).toBeDefined();
    expect(toolPart.state).toBe("input-available");
    expect(toolPart.active).toBe(true);
    expect(toolPart.output).toBeUndefined();
  });

  it("preserves persisted attachment metadata on rehydrated UI messages", () => {
    const now = new Date().toISOString();

    const uiMessages = convertDBMessagesToUIMessages([
      {
        id: "u-meta",
        role: "user",
        content: [
          {
            type: "image",
            image: "/api/media/sessions/sess-1/uploads/mockup.png",
            filename: "mockup.png",
            mediaType: "image/png",
          },
        ],
        metadata: {
          custom: {
            attachments: [
              {
                name: "mockup.png",
                contentType: "image/png",
                url: "/api/media/sessions/sess-1/uploads/mockup.png",
                localPath: "sessions/sess-1/uploads/mockup.png",
                filePath: "/tmp/sessions/sess-1/uploads/mockup.png",
                kind: "image",
              },
            ],
          },
        },
        createdAt: now,
        orderingIndex: 1,
      },
    ] as any);

    expect((uiMessages[0]?.metadata as any)?.custom?.attachments).toEqual([
      expect.objectContaining({
        url: "/api/media/sessions/sess-1/uploads/mockup.png",
        localPath: "sessions/sess-1/uploads/mockup.png",
        filePath: "/tmp/sessions/sess-1/uploads/mockup.png",
        kind: "image",
      }),
    ]);
  });

});
