import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => "auth-user-1"),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
}));

const ttsMocks = vi.hoisted(() => ({
  isTTSAvailable: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock("@/lib/auth/local-auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: settingsMocks.loadSettings,
}));

vi.mock("@/lib/tts/manager", () => ({
  isTTSAvailable: ttsMocks.isTTSAvailable,
  synthesizeSpeech: ttsMocks.synthesizeSpeech,
}));

import { POST } from "@/app/api/voice/speak/route";

describe("POST /api/voice/speak", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMocks.loadSettings.mockReturnValue({ ttsReadCodeBlocks: false });
    ttsMocks.isTTSAvailable.mockReturnValue(true);
    ttsMocks.synthesizeSpeech.mockResolvedValue({
      audio: Buffer.from("audio"),
      mimeType: "audio/mpeg",
    });
  });

  it("keeps code blocks with a Code prefix when enabled", async () => {
    settingsMocks.loadSettings.mockReturnValue({ ttsReadCodeBlocks: true });

    const response = await POST(
      new Request("http://localhost/api/voice/speak", {
        method: "POST",
        body: JSON.stringify({
          text: "Intro\n```ts\nconst answer = 42;\n```\nDone.",
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(ttsMocks.synthesizeSpeech).toHaveBeenCalledWith({
      text: "Intro\n\nCode: const answer equals 42 semicolon\n\nDone.",
      voice: undefined,
      speed: undefined,
    });
  });

  it("removes code blocks when the setting is disabled", async () => {
    const response = await POST(
      new Request("http://localhost/api/voice/speak", {
        method: "POST",
        body: JSON.stringify({
          text: "Intro\n```ts\nconst answer = 42;\n```\nDone.",
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(ttsMocks.synthesizeSpeech).toHaveBeenCalledWith({
      text: "Intro\n\nDone.",
      voice: undefined,
      speed: undefined,
    });
  });

  it("returns 401 when auth fails", async () => {
    authMocks.requireAuth.mockRejectedValueOnce(new Error("Unauthorized"));

    const response = await POST(
      new Request("http://localhost/api/voice/speak", {
        method: "POST",
        body: JSON.stringify({ text: "Hello" }),
      }) as never,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
