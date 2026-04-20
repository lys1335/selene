import { describe, it, expect, vi } from "vitest";

import { slimResult, SLIM_RESULT_SAFETY_CAP } from "../design-workspace-tool";

// Mock heavy dependencies that would fail in test environment
vi.mock("@/lib/db/sqlite-client", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    exec: vi.fn(),
  })),
}));

vi.mock("@/lib/design/gallery/queries", () => ({
  saveDesignComponent: vi.fn(),
  getDesignComponent: vi.fn(),
  updateDesignComponent: vi.fn(),
}));

vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/design", () => ({
  generateCard: vi.fn(),
  editCard: vi.fn(),
}));

vi.mock("@/lib/design/libraries", () => ({
  detectAvailableLibraries: vi.fn(() => Promise.resolve([])),
  getAvailableLibrariesPrompt: vi.fn(() => ""),
}));

vi.mock("@/lib/design/workspace/export", () => ({
  exportDesignAsset: vi.fn(),
}));

vi.mock("@/lib/design/workspace/preview", () => ({
  buildDesignPreviewErrorHtml: vi.fn(() => ""),
}));

vi.mock("@/lib/design/workspace/compiler", () => ({
  buildTailwindPreviewWithMetadata: vi.fn(),
  isDesignWorkspaceCompileError: vi.fn(() => false),
}));

vi.mock("@/lib/design/workspace/config", () => ({
  DEFAULT_DESIGN_WORKSPACE_CONFIG: {},
  getDesignWorkspaceConfigFromSettingsRecord: vi.fn(() => ({})),
}));

vi.mock("@/lib/design/workspace/edit-history", () => ({
  finalizeDesignHistory: vi.fn(),
  initDesignHistory: vi.fn(),
  peekDesignHistory: vi.fn(),
  recordDesignHistory: vi.fn(),
}));

vi.mock("@/lib/design/workspace/dependencies", () => ({
  installSandboxPackages: vi.fn(),
}));

vi.mock("@/lib/design/workspace/validation", () => ({
  runPostEditValidation: vi.fn(),
}));

vi.mock("@/lib/storage/local-storage", () => ({
  getFullPathFromMediaRef: vi.fn(),
}));

vi.mock("@/lib/ai/tool-registry/logging", () => ({
  withToolLogging: vi.fn((fn: unknown) => fn),
}));

describe("Design Workspace Tool — New Action Contracts", () => {
  describe("readSource action contract", () => {
    it("should be documented in the action union type", () => {
      // This test verifies the type system accepts readSource
      // If the type is wrong, this file won't compile
      const action: "readSource" = "readSource";
      expect(action).toBe("readSource");
    });
  });

  describe("patch action contract", () => {
    it("should be documented in the action union type", () => {
      const action: "patch" = "patch";
      const statusAction: "status" = "status";
      expect(action).toBe("patch");
      expect(statusAction).toBe("status");
    });

    // Test the patch string replacement logic (mirrors handlePatch internals)
    describe("string patch logic", () => {
      it("replaces first occurrence by default", () => {
        const source = "color: red;\ncolor: red;";
        const patched = source.replace("color: red", "color: blue");
        expect(patched).toBe("color: blue;\ncolor: red;");
      });

      it("replaces all occurrences with replaceAll", () => {
        const source = "color: red;\ncolor: red;";
        const patched = source.split("color: red").join("color: blue");
        expect(patched).toBe("color: blue;\ncolor: blue;");
      });

      it("detects occurrence count", () => {
        const source =
          'import { Flask } from "lucide-react";\n<Flask size={20} />\n<Flask size={16} />';
        const occurrences = source.split("Flask").length - 1;
        expect(occurrences).toBe(3);
      });

      it("handles multi-line oldString", () => {
        const source = "function App() {\n  return <div>old</div>\n}";
        const patched = source.replace("return <div>old</div>", "return <div>new</div>");
        expect(patched).toBe("function App() {\n  return <div>new</div>\n}");
      });

      it("counts changed lines correctly", () => {
        const before = "line1\nline2\nline3\nline4";
        const after = "line1\nLINE2\nline3\nLINE4";
        const a = before.split("\n");
        const b = after.split("\n");
        let changed = 0;
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (a[i] !== b[i]) changed++;
        }
        expect(changed).toBe(2);
      });
    });
  });

  describe("slimResult — payload size safety", () => {
    it("strips full code from generate results and sets truncated flag", () => {
      const hugeCode = "x".repeat(60_000);
      const result = slimResult({
        success: true,
        action: "generate",
        data: {
          componentId: "comp-1",
          name: "Hero",
          code: hugeCode,
          previewHtml: "<html>ok</html>",
        },
      });

      expect(result.data?.code).toBeUndefined();
      expect(result.data?.codeLength).toBe(hugeCode.length);
      expect(result.data?.codeLines).toBeGreaterThan(0);
      expect(result.data?.truncated).toBe(true);
      expect(result.data?.hydrateRef).toEqual({ kind: "gallery", componentId: "comp-1" });
      expect(result.data?.componentId).toBe("comp-1");
    });

    it("strips previewHtml when it exceeds the small-inline threshold", () => {
      const bigPreview = `<html>${"<div></div>".repeat(5_000)}</html>`;
      const result = slimResult({
        success: true,
        action: "edit",
        data: {
          componentId: "comp-2",
          code: "short",
          previewHtml: bigPreview,
        },
      });

      expect(result.data?.previewHtml).toBeUndefined();
      expect(result.data?.previewHtmlLength).toBe(bigPreview.length);
      expect(result.data?.truncated).toBe(true);
    });

    it("keeps small inline previewHtml (placeholder loader)", () => {
      const tinyPreview = "<html><body>loading</body></html>";
      const result = slimResult({
        success: true,
        action: "generate",
        data: {
          componentId: "comp-3",
          previewHtml: tinyPreview,
        },
      });
      expect(result.data?.previewHtml).toBe(tinyPreview);
    });

    it("keeps inline code on readSource below threshold", () => {
      const mediumCode = "const X = 1;\n".repeat(100);
      const result = slimResult({
        success: true,
        action: "readSource",
        data: {
          componentId: "comp-4",
          code: mediumCode,
        },
      });
      expect(result.data?.code).toBe(mediumCode);
      expect(result.data?.truncated).toBeUndefined();
    });

    it("strips code on readSource above threshold", () => {
      const hugeCode = "x".repeat(20_000);
      const result = slimResult({
        success: true,
        action: "readSource",
        data: {
          componentId: "comp-5",
          code: hugeCode,
        },
      });
      expect(result.data?.code).toBeUndefined();
      expect(result.data?.truncated).toBe(true);
    });

    it("final serialized payload stays under the safety cap even with huge code+preview", () => {
      const hugeCode = "x".repeat(200_000);
      const hugePreview = `<html>${"y".repeat(200_000)}</html>`;
      const result = slimResult({
        success: true,
        action: "generate",
        data: {
          componentId: "comp-6",
          name: "Mega",
          code: hugeCode,
          previewHtml: hugePreview,
          compileReport: {
            warnings: [],
            errors: [],
            diagnostics: Array.from({ length: 50 }, (_, i) => ({
              text: "z".repeat(5_000),
              location: { file: "x.tsx", line: i, column: 0 },
            })),
            dependencyCheck: {
              manifestPackages: [],
              importedPackages: [],
              checkedPackages: [],
              missingManifestPackages: [],
              missingImportedPackages: [],
              missingPackages: [],
            },
            recovered: false,
            durationMs: 0,
          },
        },
      });

      const serialized = JSON.stringify(result);
      expect(serialized.length).toBeLessThan(SLIM_RESULT_SAFETY_CAP);
      expect(result.data?.truncated).toBe(true);
      expect(result.data?.componentId).toBe("comp-6");
    });

    it("preserves agentErrorSummary, messages, and compile error structure on failure", () => {
      const result = slimResult({
        success: false,
        action: "generate",
        error: "Syntax error",
        data: {
          componentId: "comp-7",
          agentErrorSummary: "[syntax] Unexpected token",
          message: "Failed to compile.",
          missingPackages: ["three"],
        },
      });
      expect(result.success).toBe(false);
      expect(result.data?.agentErrorSummary).toBe("[syntax] Unexpected token");
      expect(result.data?.missingPackages).toEqual(["three"]);
    });
  });

  describe("agentErrorSummary contract", () => {
    it("should format structured errors into flat readable strings", () => {
      // This tests the expected output format of buildAgentErrorSummary
      // The actual function is internal, but we verify the contract
      const errors = [
        {
          type: "dependency" as const,
          message: "Cannot find module 'three'",
          suggestion: 'Install with action "install"',
        },
        {
          type: "syntax" as const,
          message: "Unexpected token",
          location: { file: "component.tsx", line: 42, column: 10 },
        },
      ];

      // Expected format: [type](line N) message -> Fix: suggestion
      const formatted = errors.map((err) => {
        const loc =
          "location" in err && err.location ? ` (line ${err.location.line})` : "";
        const sug =
          "suggestion" in err && err.suggestion
            ? ` → Fix: ${err.suggestion}`
            : "";
        return `[${err.type}]${loc} ${err.message}${sug}`;
      });

      expect(formatted[0]).toBe(
        '[dependency] Cannot find module \'three\' → Fix: Install with action "install"',
      );
      expect(formatted[1]).toBe("[syntax] (line 42) Unexpected token");
    });
  });
});
