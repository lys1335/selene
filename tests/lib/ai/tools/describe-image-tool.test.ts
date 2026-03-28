import { unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  tool: ({ execute, inputSchema, description }: any) => ({ execute, inputSchema, description }),
  jsonSchema: (schema: any) => schema,
  generateText: vi.fn(),
}));

vi.mock("@/lib/ai/providers", () => ({
  getVisionModel: vi.fn(() => "mock-vision-model"),
}));

vi.mock("@/lib/ai/tool-registry/logging", () => ({
  withToolLogging: (_toolName: string, _sessionId: string | undefined, execute: any) => execute,
}));

import { generateText } from "ai";
import { createDescribeImageTool, imageToDataUrl } from "@/lib/ai/tools/image-tools-utils";
import { saveBase64Image } from "@/lib/storage/local-storage";

const mockedGenerateText = vi.mocked(generateText);

describe("describeImage tool", () => {
  beforeEach(() => {
    mockedGenerateText.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts absolute PNG file paths to data URLs", async () => {
    const fixturePath = process.platform === "win32"
      ? path.join(os.tmpdir(), `describe-image-${Date.now()}.png`)
      : "C:\\Users\\tester\\Desktop\\shot.png";

    writeFileSync(fixturePath, Buffer.from("mock"));

    try {
      const result = await imageToDataUrl(fixturePath);
      expect(result).toBe("data:image/png;base64,bW9jaw==");
    } finally {
      unlinkSync(fixturePath);
    }
  });

  it("reads stored /api/media PNG uploads through local storage resolution", async () => {
    const upload = await saveBase64Image("data:image/png;base64,bW9jaw==", "describe-image-test", "upload", "png");

    const result = await imageToDataUrl(upload.url);

    expect(result).toBe("data:image/png;base64,bW9jaw==");
  });

  it("returns actionable errors for unsupported local helper text values", async () => {
    await expect(imageToDataUrl("[Attachment: shot.png | filePath: C:\\Users\\tester\\Desktop\\shot.png]"))
      .rejects
      .toThrow("Unsupported image source for describeImage");
  });

  it("passes resolved PNG media type into the vision request", async () => {
    mockedGenerateText.mockResolvedValue({ text: "Detected a game screenshot." } as any);
    const upload = await saveBase64Image("data:image/png;base64,bW9jaw==", "describe-image-tool", "upload", "png");
    const tool = createDescribeImageTool();

    const result = await tool.execute({ imageUrl: upload.url, analysisType: "general" });

    expect(result.success).toBe(true);
    expect(result.description).toContain("game screenshot");
    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    expect(mockedGenerateText.mock.calls[0]?.[0]).toMatchObject({
      model: "mock-vision-model",
      messages: [
        {
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "image",
              mediaType: "image/png",
              image: "bW9jaw==",
            }),
          ]),
        },
      ],
    });
  });
});
