import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  getModelByName: vi.fn(() => "mock-model"),
  getResearchModel: vi.fn(() => "mock-model"),
}));

const resolverMocks = vi.hoisted(() => ({
  getSessionProviderTemperatureForSession: vi.fn(async () => 0.7),
}));

const searchMocks = vi.hoisted(() => ({
  executeSearches: vi.fn(async () => []),
  isSearchAvailable: vi.fn(() => true),
}));

const datetimeMocks = vi.hoisted(() => ({
  getTemporalContextBlock: vi.fn(() => "[time-context]"),
}));

vi.mock("ai", () => ({
  generateText: aiMocks.generateText,
}));

vi.mock("@/lib/ai/providers", () => ({
  getModelByName: providerMocks.getModelByName,
  getResearchModel: providerMocks.getResearchModel,
}));

vi.mock("@/lib/ai/session-model-resolver", () => ({
  getSessionProviderTemperatureForSession: resolverMocks.getSessionProviderTemperatureForSession,
}));

vi.mock("@/lib/ai/deep-research/search", () => ({
  executeSearches: searchMocks.executeSearches,
  isSearchAvailable: searchMocks.isSearchAvailable,
}));

vi.mock("@/lib/ai/datetime-context", () => ({
  getTemporalContextBlock: datetimeMocks.getTemporalContextBlock,
}));

describe("runDeepResearch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    providerMocks.getModelByName.mockReturnValue("mock-model");
    providerMocks.getResearchModel.mockReturnValue("mock-model");
    resolverMocks.getSessionProviderTemperatureForSession.mockResolvedValue(0.7);
    searchMocks.executeSearches.mockResolvedValue([]);
    searchMocks.isSearchAvailable.mockReturnValue(true);
    datetimeMocks.getTemporalContextBlock.mockReturnValue("[time-context]");
  });

  it("emits a structured planning error when the planner returns malformed JSON", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: '{"clarifiedQuery":"Test","researchQuestions":["One" "Two"],"scope":"Narrow","expectedSections":["Overview"]}',
    });

    const events: Array<Record<string, unknown>> = [];
    const { runDeepResearch } = await import("@/lib/ai/deep-research");

    await expect(
      runDeepResearch("Investigate malformed planner output", (event) => {
        events.push(event as unknown as Record<string, unknown>);
      })
    ).rejects.toThrow("Deep Research planner returned an incomplete plan payload.");

    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      failedPhase: "planning",
      phaseMessage: "Research plan generation failed.",
      code: "DEEP_RESEARCH_PLAN_INVALID_SHAPE",
    });
    expect(errorEvent?.debug).toMatchObject({
      parseMessage: expect.stringContaining("Expected ',' or ']'"),
      extractedJsonPreview: '["Overview"]',
      rawResponsePreview: expect.stringContaining('"researchQuestions"'),
    });
  });

  it("falls back to the first valid JSON payload when the model prepends stray braces", async () => {
    aiMocks.generateText
      .mockResolvedValueOnce({
        text: 'note: {not json}\n{"clarifiedQuery":"Recovered query","researchQuestions":["Question 1"],"scope":"Scoped","expectedSections":["Intro"]}',
      })
      .mockResolvedValueOnce({ text: '{"queries":["query a"]}' })
      .mockResolvedValueOnce({ text: "# Draft report\n\nBody" })
      .mockResolvedValueOnce({ text: '{"informationGaps":[],"suggestedSearches":[]}' })
      .mockResolvedValueOnce({ text: "# Final report\n\nAll done." });

    const { runDeepResearch } = await import("@/lib/ai/deep-research");

    const state = await runDeepResearch("Recover planner JSON", () => {}, { maxIterations: 2 });

    expect(state.plan).toMatchObject({
      clarifiedQuery: "Recovered query",
      researchQuestions: ["Question 1"],
      expectedSections: ["Intro"],
    });
    expect(state.finalReport?.title).toBe("Final report");
  });
});
