import { describe, expect, it } from "vitest";
import { formatCodeForSpeech, formatTextForTTS } from "@/lib/voice/format-tts-text";

describe("formatCodeForSpeech", () => {
  it("verbalizes structural code symbols and operators", () => {
    expect(formatCodeForSpeech("items[0] === foo.bar();", true)).toBe(
      "items open bracket 0 close bracket triple equals foo dot bar open parenthesis close parenthesis semicolon",
    );
  });

  it("reads quotes and braces in function calls", () => {
    expect(formatCodeForSpeech("print('hello') { }", true)).toBe(
      "print open parenthesis single quote hello single quote close parenthesis open brace close brace",
    );
  });
});

describe("formatTextForTTS", () => {
  it("preserves fenced code blocks with speech-friendly code when enabled", () => {
    expect(
      formatTextForTTS("Intro\n```ts\nconst answer = 42;\n```\nDone.", true, true),
    ).toBe("Intro\n\nCode: const answer equals 42 semicolon\n\nDone.");
  });

  it("formats inline code with symbol speech when enabled", () => {
    expect(formatTextForTTS("Use `foo(bar)` now.", true, true)).toBe(
      "Use foo open parenthesis bar close parenthesis now.",
    );
  });

  it("removes fenced code blocks when disabled", () => {
    expect(
      formatTextForTTS("Intro\n```ts\nconst answer = 42;\n```\nDone."),
    ).toBe("Intro\n\nDone.");
  });
});
