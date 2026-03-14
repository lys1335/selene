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

  it("keeps helper text mode unchanged for live model requests", async () => {
    const result = await extractContent(
      {
        role: "user",
        experimental_attachments: [
          {
            name: "mockup.png",
            contentType: "image/png",
            url: "/api/media/sessions/sess-1/uploads/mockup.png",
          },
        ],
      },
      true,
      false,
    );

    expect(result).toBe("[mockup.png URL: /api/media/sessions/sess-1/uploads/mockup.png]");
  });
});
