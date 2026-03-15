import { describe, expect, it } from "vitest";

import {
  getAttachmentDisplayName,
  getAttachmentImageUrl,
} from "@/components/assistant-ui/thread-message-components";

describe("getAttachmentImageUrl", () => {
  it("returns inline image content URLs", () => {
    expect(
      getAttachmentImageUrl({
        content: [{ type: "image", image: "/api/media/sessions/sess-1/uploads/mockup.png" }],
      }),
    ).toBe("/api/media/sessions/sess-1/uploads/mockup.png");
  });

  it("returns file URLs for image file attachments after message rehydration", () => {
    expect(
      getAttachmentImageUrl({
        contentType: "image/png",
        content: [
          {
            type: "file",
            url: "/api/media/sessions/sess-1/uploads/mockup.png",
            mimeType: "image/png",
          },
        ],
      }),
    ).toBe("/api/media/sessions/sess-1/uploads/mockup.png");
  });

  it("derives a real filename when the attachment name is only a generic placeholder", () => {
    expect(
      getAttachmentDisplayName({
        name: "file",
        content: [
          {
            type: "file",
            url: "/api/media/sessions/sess-1/uploads/Screenshot%202026-03-09%20at%2018.06.03.png",
          },
        ],
      }),
    ).toBe("Screenshot 2026-03-09 at 18.06.03.png");
  });
});
