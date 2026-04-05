/**
 * Tests for think-tag stream middleware utilities.
 */

import { describe, it, expect } from "vitest";
import { hasThinkTags } from "../think-tag-stream";

// ---------------------------------------------------------------------------
// hasThinkTags
// ---------------------------------------------------------------------------

describe("hasThinkTags", () => {
  describe("always-think-tag providers", () => {
    it("returns true for vllm regardless of ollamaSupportsThinking", () => {
      expect(hasThinkTags("vllm")).toBe(true);
      expect(hasThinkTags("vllm", true)).toBe(true);
      expect(hasThinkTags("vllm", false)).toBe(true);
      expect(hasThinkTags("vllm", undefined)).toBe(true);
    });

    it("is case-insensitive for provider names", () => {
      expect(hasThinkTags("VLLM")).toBe(true);
      expect(hasThinkTags("Vllm")).toBe(true);
    });
  });

  describe("ollama — capability-aware", () => {
    it("returns true when ollamaSupportsThinking is undefined (safety fallback)", () => {
      expect(hasThinkTags("ollama")).toBe(true);
      expect(hasThinkTags("ollama", undefined)).toBe(true);
    });

    it("returns true when ollamaSupportsThinking is false (legacy Ollama)", () => {
      expect(hasThinkTags("ollama", false)).toBe(true);
    });

    it("returns false when ollamaSupportsThinking is true (native thinking)", () => {
      // Ollama v0.9.0+ handles thinking server-side — no middleware needed
      expect(hasThinkTags("ollama", true)).toBe(false);
    });

    it("is case-insensitive for ollama provider name", () => {
      expect(hasThinkTags("Ollama", true)).toBe(false);
      expect(hasThinkTags("OLLAMA")).toBe(true);
      expect(hasThinkTags("OLLAMA", false)).toBe(true);
    });
  });

  describe("providers that never emit think tags", () => {
    it("returns false for anthropic", () => {
      expect(hasThinkTags("anthropic")).toBe(false);
    });

    it("returns false for openai", () => {
      expect(hasThinkTags("openai")).toBe(false);
    });

    it("returns false for openrouter", () => {
      expect(hasThinkTags("openrouter")).toBe(false);
    });

    it("returns false for unknown providers", () => {
      expect(hasThinkTags("some-new-provider")).toBe(false);
    });
  });
});
