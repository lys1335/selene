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
      expect(hasThinkTags({ provider: "vllm" })).toBe(true);
      expect(hasThinkTags({ provider: "vllm", ollamaSupportsThinking: true })).toBe(true);
      expect(hasThinkTags({ provider: "vllm", ollamaSupportsThinking: false })).toBe(true);
      expect(hasThinkTags({ provider: "vllm", ollamaSupportsThinking: undefined })).toBe(true);
    });

    it("is case-insensitive for provider names", () => {
      expect(hasThinkTags({ provider: "VLLM" })).toBe(true);
      expect(hasThinkTags({ provider: "Vllm" })).toBe(true);
    });
  });

  describe("ollama — capability-aware", () => {
    it("returns false when ollamaSupportsThinking is undefined and no model (safe default)", () => {
      expect(hasThinkTags({ provider: "ollama" })).toBe(false);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: undefined })).toBe(false);
    });

    it("returns false when ollamaSupportsThinking is false and model is not a thinking model", () => {
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "gemma3:latest" })).toBe(false);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "llama3.1:8b" })).toBe(false);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "mistral:7b" })).toBe(false);
    });

    it("returns true when ollamaSupportsThinking is false and model matches think-tag patterns", () => {
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "deepseek-r1:14b" })).toBe(true);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "qwen3.5:7b" })).toBe(true);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "qwq:32b" })).toBe(true);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: undefined, modelId: "deepseek-coder:latest" })).toBe(true);
    });

    it("returns false when ollamaSupportsThinking is true (native thinking)", () => {
      // Ollama v0.9.0+ handles thinking server-side — no middleware needed
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: true })).toBe(false);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: true, modelId: "deepseek-r1:14b" })).toBe(false);
    });

    it("is case-insensitive for ollama provider name and model", () => {
      expect(hasThinkTags({ provider: "Ollama", ollamaSupportsThinking: true })).toBe(false);
      expect(hasThinkTags({ provider: "OLLAMA", ollamaSupportsThinking: false, modelId: "DeepSeek-R1:14b" })).toBe(true);
      expect(hasThinkTags({ provider: "OLLAMA", ollamaSupportsThinking: false, modelId: "gemma3:latest" })).toBe(false);
    });
  });

  describe("providers that never emit think tags", () => {
    it("returns false for anthropic", () => {
      expect(hasThinkTags({ provider: "anthropic" })).toBe(false);
    });

    it("returns false for openai", () => {
      expect(hasThinkTags({ provider: "openai" })).toBe(false);
    });

    it("returns false for openrouter", () => {
      expect(hasThinkTags({ provider: "openrouter" })).toBe(false);
    });

    it("returns false for unknown providers", () => {
      expect(hasThinkTags({ provider: "some-new-provider" })).toBe(false);
    });
  });

  describe("r1 pattern — word-boundary matching", () => {
    it("matches model names with r1 after word boundary", () => {
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "deepseek-r1" })).toBe(true);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "r1:14b" })).toBe(true);
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "kimi-r1-preview" })).toBe(true);
    });

    it("does not match model names where r1 is part of another word", () => {
      expect(hasThinkTags({ provider: "ollama", ollamaSupportsThinking: false, modelId: "gpt4r1x" })).toBe(false);
    });
  });
});
