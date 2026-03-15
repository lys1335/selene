import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { prepareMessagesForRequest } from "@/app/api/chat/message-prep";

const MEDIA_ROOT = process.env.LOCAL_DATA_PATH
  ? path.join(process.env.LOCAL_DATA_PATH, "media")
  : path.join(process.cwd(), ".local-data", "media");
const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "documents");

function writeMediaFixture(relativePath: string, fixtureName: string): string {
  const fullPath = path.join(MEDIA_ROOT, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, readFileSync(path.join(FIXTURE_DIR, fixtureName)));
  return fullPath;
}

describe("document attachment extraction propagation (integration)", () => {
  it("injects extracted document text into prepared core messages", async () => {
    const relativePath = "docs-tests/integration/sample.docx";
    const fullPath = writeMediaFixture(relativePath, "sample.docx");

    const { coreMessages } = await prepareMessagesForRequest({
      messages: [
        {
          role: "user",
          experimental_attachments: [
            {
              name: "sample.docx",
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              url: `/api/media/${relativePath}`,
              filePath: fullPath,
            },
          ],
        },
      ],
      sessionId: "sess-doc-attachment",
      userId: "user-doc-attachment",
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

    expect(textParts.join("\n")).toContain("[Attachment content: sample.docx]");
    expect(textParts.join("\n")).toContain("Demonstration of DOCX support in calibre");
  });
});
