import { describe, expect, it } from "vitest";
import { prepareMessagesForRequest } from "@/app/api/chat/message-prep";

describe("attachment path helper propagation (integration)", () => {
  it("keeps helper text path-aware in prepared core messages", async () => {
    const attachmentUrl = "https://example.com/mockup.png";
    const attachmentFilePath = "/tmp/sessions/sess-1/uploads/mockup.png";

    const { coreMessages } = await prepareMessagesForRequest({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "whats the path?" },
            {
              type: "file",
              url: attachmentUrl,
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
                  url: attachmentUrl,
                  localPath: "sessions/sess-1/uploads/mockup.png",
                  filePath: attachmentFilePath,
                },
              ],
            },
          },
        },
      ],
      sessionId: "sess-path-propagation",
      userId: "user-path-propagation",
      characterId: null,
      sessionMetadata: {},
      currentModelId: "gpt-5.4",
      currentProvider: "codex",
    });

    expect(coreMessages).toHaveLength(1);
    const userMessage = coreMessages[0];
    expect(userMessage?.role).toBe("user");
    expect(Array.isArray(userMessage?.content)).toBe(true);

    const textParts = (userMessage?.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "");

    expect(textParts.join("\n")).toContain(
      `[Attachment: mockup.png | filePath: ${attachmentFilePath}]`,
    );
    expect(textParts.join("\n")).not.toContain("[mockup.png URL:");
  });
});
