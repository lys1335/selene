import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TEXT_CONTENT_LENGTH,
  sanitizeAssistantOutputText,
  sanitizeTextContent,
  normalizeReadFileInputArgs,
} from "@/app/api/chat/content-sanitizer";
import { storeFullContent } from "@/lib/ai/truncated-content-store";

vi.mock("@/lib/ai/truncated-content-store", () => ({
  storeFullContent: vi.fn(() => "trunc_test_123"),
}));

const leakedPlanningText =
  "I need continue with actual tools available names. Only commentary tools under functions.* not tool. Need sequential edits. Must read current files before edit. Need use editFile and run tests. Let's implement carefully. Need add setting to app/settings/settings-types FormState.";

describe("sanitizeAssistantOutputText", () => {
  it("strips leaked internal planning prose when tool-call context is present", () => {
    expect(
      sanitizeAssistantOutputText(leakedPlanningText, { hasToolCallLikeParts: true })
    ).toBe("");
  });

  it("preserves the same text when there is no tool-call context", () => {
    expect(sanitizeAssistantOutputText(leakedPlanningText)).toBe(leakedPlanningText);
  });

  it("preserves normal assistant text even when tool-call context is present", () => {
    const text = "I checked the files and updated the response formatting.";
    expect(sanitizeAssistantOutputText(text, { hasToolCallLikeParts: true })).toBe(text);
  });
});

describe("content-sanitizer text length limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a 25,000 character limit", () => {
    expect(MAX_TEXT_CONTENT_LENGTH).toBe(25_000);
  });

  it("does not truncate text at exactly the limit", () => {
    const chunk = "This is normal prose with spaces and punctuation.X";
    const input = chunk.repeat(Math.ceil(MAX_TEXT_CONTENT_LENGTH / chunk.length)).slice(0, MAX_TEXT_CONTENT_LENGTH);
    const output = sanitizeTextContent(input, "unit-test", "session-1");
    expect(output).toBe(input);
    expect(storeFullContent).not.toHaveBeenCalled();
  });

  it("truncates and stores full content when over limit with sessionId", () => {
    const chunk = "Long user prompt content with spaces, punctuation, and symbols !? ";
    const input = chunk
      .repeat(Math.ceil((MAX_TEXT_CONTENT_LENGTH + 500) / chunk.length))
      .slice(0, MAX_TEXT_CONTENT_LENGTH + 500);
    const output = sanitizeTextContent(input, "unit-test", "session-2");

    expect(storeFullContent).toHaveBeenCalledTimes(1);
    expect(storeFullContent).toHaveBeenCalledWith(
      "session-2",
      "unit-test",
      input,
      MAX_TEXT_CONTENT_LENGTH
    );
    expect(output.length).toBeGreaterThan(MAX_TEXT_CONTENT_LENGTH);
    expect(output).toContain("CONTENT TRUNCATED");
    expect(output).toContain("25,000");
    expect(output).toContain('contentId="trunc_test_123"');
  });

  it("truncates with fallback notice when sessionId is missing", () => {
    const chunk = "Another long content block with natural language and spaces. ";
    const input = chunk
      .repeat(Math.ceil((MAX_TEXT_CONTENT_LENGTH + 1) / chunk.length))
      .slice(0, MAX_TEXT_CONTENT_LENGTH + 1);
    const output = sanitizeTextContent(input, "unit-test");

    expect(storeFullContent).not.toHaveBeenCalled();
    expect(output).toContain("Content truncated at 25,000 chars");
  });
});

describe("normalizeReadFileInputArgs", () => {
  it("drops head/tail when line range is present", () => {
    const { normalizedArgs, droppedSelectors } = normalizeReadFileInputArgs({
      filePath: "foo.ts",
      startLine: 10,
      endLine: 20,
      head: 5,
      tail: 5,
    });

    expect(normalizedArgs).toEqual({
      filePath: "foo.ts",
      startLine: 10,
      endLine: 20,
    });
    expect(droppedSelectors).toEqual(expect.arrayContaining(["head", "tail"]));
  });

  it("drops non-finite selector values", () => {
    const { normalizedArgs, droppedSelectors } = normalizeReadFileInputArgs({
      filePath: "foo.ts",
      head: Number.POSITIVE_INFINITY,
      tail: Number.NaN,
    });

    expect(normalizedArgs).toEqual({ filePath: "foo.ts" });
    expect(droppedSelectors).toEqual(expect.arrayContaining(["head", "tail"]));
  });
});
