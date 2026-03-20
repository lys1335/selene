/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => "auth-user-1"),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(() => ({ localUserEmail: "local@example.com", llmProvider: "anthropic" })),
}));

const dbMocks = vi.hoisted(() => ({
  getOrCreateLocalUser: vi.fn(async () => ({ id: "user-1" })),
  getSession: vi.fn(),
  createSession: vi.fn(),
  createMessage: vi.fn(async () => ({ id: "message-1" })),
}));

const resolverMocks = vi.hoisted(() => ({
  resolveSessionModelScopeForSession: vi.fn(),
}));

const deepResearchMocks = vi.hoisted(() => ({
  runDeepResearch: vi.fn(async (_query: string, emit: (event: unknown) => void) => {
    emit({
      type: "phase_change",
      phase: "planning",
      message: "Planning research",
      timestamp: new Date("2026-03-20T00:00:00.000Z"),
    });
    emit({
      type: "final_report",
      report: {
        title: "Done",
        content: "Finished report",
        citations: [],
        generatedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
      timestamp: new Date("2026-03-20T00:00:01.000Z"),
    });

    return {
      plan: undefined,
      finalReport: {
        title: "Done",
        content: "Finished report",
        citations: [],
        generatedAt: new Date("2026-03-20T00:00:01.000Z"),
      },
    };
  }),
}));

const webSearchMocks = vi.hoisted(() => ({
  getWebSearchProviderStatus: vi.fn(() => ({ available: true, activeProvider: "duckduckgo", enhanced: false })),
}));

const observabilityMocks = vi.hoisted(() => ({
  createAgentRun: vi.fn(async () => ({ id: "run-1", startedAt: new Date("2026-03-20T00:00:00.000Z").toISOString() })),
  completeAgentRun: vi.fn(async () => undefined),
  updateAgentRunMetadata: vi.fn(async () => undefined),
  withRunContext: vi.fn(async (_ctx: unknown, fn: () => Promise<void>) => fn()),
  appendRunEvent: vi.fn(async () => undefined),
}));

const taskRegistryMocks = vi.hoisted(() => ({
  register: vi.fn(),
  emitProgress: vi.fn(),
  updateStatus: vi.fn(),
}));

const abortRegistryMocks = vi.hoisted(() => ({
  registerChatAbortController: vi.fn(),
  removeChatAbortController: vi.fn(),
}));

const interruptionMocks = vi.hoisted(() => ({
  buildInterruptionMessage: vi.fn(() => "Interrupted"),
  buildInterruptionMetadata: vi.fn(() => ({ interrupted: true })),
}));

const messageOrderingMocks = vi.hoisted(() => ({
  nextOrderingIndex: vi.fn(async () => 1),
}));

vi.mock("@/lib/auth/local-auth", () => authMocks);
vi.mock("@/lib/settings/settings-manager", () => settingsMocks);
vi.mock("@/lib/db/queries", () => dbMocks);
vi.mock("@/lib/ai/session-model-resolver", () => resolverMocks);
vi.mock("@/lib/ai/deep-research", () => deepResearchMocks);
vi.mock("@/lib/ai/web-search/providers", () => webSearchMocks);
vi.mock("@/lib/observability", () => observabilityMocks);
vi.mock("@/lib/background-tasks/registry", () => ({ taskRegistry: taskRegistryMocks }));
vi.mock("@/lib/background-tasks/chat-abort-registry", () => abortRegistryMocks);
vi.mock("@/lib/messages/interruption", () => interruptionMocks);
vi.mock("@/lib/session/message-ordering", () => messageOrderingMocks);

import { POST } from "@/app/api/deep-research/route";

describe("POST /api/deep-research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      characterId: "char-1",
      metadata: { sessionProvider: "codex" },
    });
    resolverMocks.resolveSessionModelScopeForSession.mockResolvedValue({
      effectiveConfig: {
        provider: "codex",
        chatModel: "gpt-agent-chat",
        researchModel: "gpt-agent-research",
        visionModel: "gpt-agent-chat",
        utilityModel: "gpt-utility-default",
      },
      sources: {
        provider: "agent",
        chatModel: "agent",
        researchModel: "agent",
        visionModel: "agent",
        utilityModel: "provider-default",
      },
    });
  });

  it("uses the fully resolved session research config for deep research runs", async () => {
    const req = new Request("http://localhost/api/deep-research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "Map the regression",
        sessionId: "session-1",
        config: {
          maxIterations: 4,
          modelProvider: "anthropic",
        },
      }),
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(resolverMocks.resolveSessionModelScopeForSession).toHaveBeenCalledWith(
      { sessionProvider: "codex" },
      expect.objectContaining({
        characterId: "char-1",
        settings: expect.objectContaining({ llmProvider: "anthropic" }),
      }),
    );
    expect(deepResearchMocks.runDeepResearch).toHaveBeenCalledWith(
      "Map the regression",
      expect.any(Function),
      expect.objectContaining({
        maxIterations: 4,
        modelProvider: "anthropic",
        researchModel: "gpt-agent-research",
        sessionProvider: "codex",
      }),
    );
    expect(observabilityMocks.createAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolvedModelConfig: {
            provider: "codex",
            researchModel: "gpt-agent-research",
            researchSource: "agent",
          },
        }),
      }),
    );
  });

  it("keeps explicit session research overrides ahead of agent defaults", async () => {
    resolverMocks.resolveSessionModelScopeForSession.mockResolvedValueOnce({
      effectiveConfig: {
        provider: "codex",
        chatModel: "gpt-session-chat",
        researchModel: "gpt-session-research",
        visionModel: "gpt-session-chat",
        utilityModel: "gpt-utility-default",
      },
      sources: {
        provider: "session",
        chatModel: "session",
        researchModel: "session",
        visionModel: "session",
        utilityModel: "provider-default",
      },
    });

    const req = new Request("http://localhost/api/deep-research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "Use explicit override",
        sessionId: "session-1",
      }),
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(deepResearchMocks.runDeepResearch).toHaveBeenCalledWith(
      "Use explicit override",
      expect.any(Function),
      expect.objectContaining({
        researchModel: "gpt-session-research",
        sessionProvider: "codex",
      }),
    );
  });
});
