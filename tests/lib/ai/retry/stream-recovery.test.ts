import { describe, expect, it } from "vitest";

import {
  classifyRecoverability,
  getFriendlyErrorMessage,
  normalizeStreamError,
} from "@/lib/ai/retry/stream-recovery";

describe("stream-recovery", () => {
  describe("ECONNREFUSED transient pattern", () => {
    it("classifies ECONNREFUSED as recoverable", () => {
      const result = classifyRecoverability(
        new Error("connect ECONNREFUSED 127.0.0.1:11434"),
      );
      expect(result.recoverable).toBe(true);
      expect(result.reason).toBe("recoverable_payload");
    });

    it("classifies lowercase econnrefused as recoverable", () => {
      const result = classifyRecoverability(
        new Error("connect econnrefused 127.0.0.1:11434"),
      );
      expect(result.recoverable).toBe(true);
      expect(result.reason).toBe("recoverable_payload");
    });

    it("classifies ECONNREFUSED on non-standard port as recoverable", () => {
      const result = classifyRecoverability(
        new Error("connect ECONNREFUSED 192.168.1.10:8080"),
      );
      expect(result.recoverable).toBe(true);
      expect(result.reason).toBe("recoverable_payload");
    });
  });

  describe("getFriendlyErrorMessage", () => {
    it("returns Ollama-not-running message for ECONNREFUSED on port 11434", () => {
      const normalized = normalizeStreamError(
        new Error("connect ECONNREFUSED 127.0.0.1:11434"),
      );
      expect(getFriendlyErrorMessage(normalized)).toBe(
        "Ollama is not running. Start it with `ollama serve` and try again.",
      );
    });

    it("returns null for ECONNREFUSED on a different port", () => {
      const normalized = normalizeStreamError(
        new Error("connect ECONNREFUSED 127.0.0.1:8080"),
      );
      expect(getFriendlyErrorMessage(normalized)).toBeNull();
    });

    it("returns model-not-found message for 404 with model mention", () => {
      const normalized = normalizeStreamError({
        message: "model 'llama3' not found",
        statusCode: 404,
      });
      expect(getFriendlyErrorMessage(normalized)).toBe(
        "Model not found. Run `ollama pull <model>` to download it first.",
      );
    });

    it("returns null for 404 without model mention", () => {
      const normalized = normalizeStreamError({
        message: "not found",
        statusCode: 404,
      });
      expect(getFriendlyErrorMessage(normalized)).toBeNull();
    });

    it("returns null for unrecognized errors", () => {
      const normalized = normalizeStreamError(
        new Error("something unexpected happened"),
      );
      expect(getFriendlyErrorMessage(normalized)).toBeNull();
    });
  });
});
