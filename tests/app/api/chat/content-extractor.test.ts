import { describe, expect, it } from "vitest";
import { extractContent } from "@/app/api/chat/content-extractor";

describe("extractContent attachment persistence", () => {
  it("preserves image parts as machine-usable references for stored history", async () => {
    const result = await extractContent({
      role: "user",
      parts: [
        {
          type: "image",
          image: "/api/media/sessions/sess-1/uploads/mockup.png",
        },
      ],
    });

    expect(result).toEqual([
      {
        type: "image",
        image: "/api/media/sessions/sess-1/uploads/mockup.png",
      },
    ]);
  });

  it("preserves experimental image attachments as machine-usable references for stored history", async () => {
    const result = await extractContent({
      role: "user",
      experimental_attachments: [
        {
          name: "mockup.png",
          contentType: "image/png",
          url: "/api/media/sessions/sess-1/uploads/mockup.png",
        },
      ],
    });

    expect(result).toEqual([
      {
        type: "image",
        image: "/api/media/sessions/sess-1/uploads/mockup.png",
      },
    ]);
  });

  it("preserves attachment metadata payloads emitted by the chat runtime", async () => {
    const result = await extractContent({
      role: "user",
      metadata: {
        custom: {
          attachments: [
            {
              name: "mockup.png",
              contentType: "image/png",
              url: "/api/media/sessions/sess-1/uploads/mockup.png",
              localPath: "sessions/sess-1/uploads/mockup.png",
              filePath: "/tmp/sessions/sess-1/uploads/mockup.png",
              size: 123,
              kind: "image",
            },
          ],
        },
      },
    });

    expect(result).toEqual([
      {
        type: "image",
        image: "/api/media/sessions/sess-1/uploads/mockup.png",
      },
    ]);
  });

  it("deduplicates identical image references when both parts and metadata attachments are present", async () => {
    const result = await extractContent({
      role: "user",
      parts: [
        {
          type: "file",
          url: "/api/media/sessions/sess-1/uploads/mockup.png",
          mediaType: "image/png",
          filename: "mockup.png",
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
            },
          ],
        },
      },
    });

    expect(result).toEqual([
      {
        type: "image",
        image: "/api/media/sessions/sess-1/uploads/mockup.png",
      },
    ]);
  });

  it("prefers filePath in helper text for live model requests", async () => {
    const result = await extractContent(
      {
        role: "user",
        experimental_attachments: [
          {
            name: "mockup.png",
            contentType: "image/png",
            url: "/api/media/sessions/sess-1/uploads/mockup.png",
            localPath: "sessions/sess-1/uploads/mockup.png",
            filePath: "/tmp/sessions/sess-1/uploads/mockup.png",
            size: 123,
            kind: "image",
          },
        ],
      },
      true,
      false,
    );

    expect(result).toBe("[Attachment: mockup.png | filePath: /tmp/sessions/sess-1/uploads/mockup.png]");
  });

  it("uses metadata filePath in helper text when part only has URL", async () => {
    const result = await extractContent(
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: "this?",
          },
          {
            type: "file",
            url: "/api/media/sessions/sess-1/uploads/mockup.png",
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
              },
            ],
          },
        },
      },
      true,
      false,
    );

    expect(result).toEqual([
      { type: "text", text: "this?" },
      { type: "text", text: "[Attachment: mockup.png | filePath: /tmp/sessions/sess-1/uploads/mockup.png]" },
    ]);
  });

  it("falls back to localPath then url when filePath is missing", async () => {
    const localPathOnly = await extractContent(
      {
        role: "user",
        experimental_attachments: [
          {
            name: "local-only.png",
            contentType: "image/png",
            url: "/api/media/sessions/sess-1/uploads/local-only.png",
            localPath: "sessions/sess-1/uploads/local-only.png",
          },
        ],
      },
      true,
      false,
    );

    expect(localPathOnly).toBe("[Attachment: local-only.png | localPath: sessions/sess-1/uploads/local-only.png]");

    const urlOnly = await extractContent(
      {
        role: "user",
        experimental_attachments: [
          {
            name: "url-only.png",
            contentType: "image/png",
            url: "/api/media/sessions/sess-1/uploads/url-only.png",
          },
        ],
      },
      true,
      false,
    );

    expect(urlOnly).toBe("[Attachment: url-only.png | url: /api/media/sessions/sess-1/uploads/url-only.png]");
  });
});
