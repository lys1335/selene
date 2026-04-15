import { describe, expect, it } from "vitest";

import {
  hasStructuredCommandOutput,
  isToolErrorResult,
  unwrapMcpTextWrappedResult,
} from "@/components/assistant-ui/tool-fallback";

describe("Bash error rendering logic", () => {
  describe("hasStructuredCommandOutput", () => {
    it("detects stderr field", () => {
      expect(
        hasStructuredCommandOutput({
          status: "error",
          stderr: "'head' is not recognized as an internal or external command",
        }),
      ).toBe(true);
    });

    it("detects stdout field", () => {
      expect(
        hasStructuredCommandOutput({
          status: "error",
          stdout: "partial output before crash",
        }),
      ).toBe(true);
    });

    it("detects exitCode field", () => {
      expect(
        hasStructuredCommandOutput({
          status: "error",
          exitCode: 255,
        }),
      ).toBe(true);
    });

    it("detects null exitCode (killed process)", () => {
      expect(
        hasStructuredCommandOutput({
          status: "error",
          exitCode: null,
        }),
      ).toBe(true);
    });

    it("returns false for plain error result without command output fields", () => {
      expect(
        hasStructuredCommandOutput({
          status: "error",
          error: "Something went wrong",
        }),
      ).toBe(false);
    });
  });

  describe("isToolErrorResult", () => {
    it("detects status: 'error'", () => {
      expect(isToolErrorResult({ status: "error" })).toBe(true);
    });

    it("detects error field as string", () => {
      expect(isToolErrorResult({ error: "something failed" })).toBe(true);
    });

    it("detects status: 'failed'", () => {
      expect(isToolErrorResult({ status: "failed" })).toBe(true);
    });

    it("detects status: 'denied'", () => {
      expect(isToolErrorResult({ status: "denied" })).toBe(true);
    });

    it("returns false for success result", () => {
      expect(isToolErrorResult({ status: "success", output: "ok" })).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isToolErrorResult(undefined)).toBe(false);
    });
  });

  describe("unwrapMcpTextWrappedResult", () => {
    it("unwraps MCP content-array-wrapped JSON with error status", () => {
      const wrapped = {
        content: [
          { type: "text", text: JSON.stringify({ status: "error", stderr: "fail", exitCode: 1 }) },
        ],
      };
      const unwrapped = unwrapMcpTextWrappedResult(wrapped);
      expect(unwrapped.status).toBe("error");
      expect(unwrapped.stderr).toBe("fail");
      expect(unwrapped.exitCode).toBe(1);
    });

    it("unwraps MCP content-string-wrapped JSON", () => {
      const wrapped = {
        content: JSON.stringify({ status: "error", stderr: "oops", exitCode: 2 }),
      };
      const unwrapped = unwrapMcpTextWrappedResult(wrapped);
      expect(unwrapped.status).toBe("error");
      expect(unwrapped.stderr).toBe("oops");
      expect(unwrapped.exitCode).toBe(2);
    });

    it("unwraps a plain JSON string", () => {
      const unwrapped = unwrapMcpTextWrappedResult(
        JSON.stringify({ status: "error", stderr: "fail" }),
      );
      expect(unwrapped.status).toBe("error");
      expect(unwrapped.stderr).toBe("fail");
    });

    it("passes through non-wrapped results unchanged", () => {
      const result = { status: "error", stderr: "fail", exitCode: 1 };
      expect(unwrapMcpTextWrappedResult(result)).toEqual(result);
    });
  });

  describe("integration: lowercase bash error result routing", () => {
    it("a structured bash error with stderr/exitCode should be detected as command-like with structured output", () => {
      const result = {
        status: "error",
        stderr:
          "'head' is not recognized as an internal or external command,\r\noperable program or batch file.",
        exitCode: 255,
      };

      // This is the exact check that ToolResultDisplay uses to decide
      // whether to render the structured command output block vs generic error
      const isError = isToolErrorResult(result);
      const hasStructured = hasStructuredCommandOutput(result);

      expect(isError).toBe(true);
      expect(hasStructured).toBe(true);
      // When both are true AND the tool is bash/executeCommand,
      // the code skips the generic "An error occurred" branch
      // and renders stderr + exitCode instead
    });

    it("a plain error without stderr/stdout/exitCode falls through to generic error", () => {
      const result = {
        status: "error",
        error: "Tool execution failed",
      };

      expect(isToolErrorResult(result)).toBe(true);
      expect(hasStructuredCommandOutput(result)).toBe(false);
      // This combination triggers the generic error display
    });
  });
});
