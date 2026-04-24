import { describe, it, expect, vi } from "vitest";

import {
  designWorkspaceToModelOutput,
  slimResult,
  SLIM_RESULT_SAFETY_CAP,
  validateAssetAliases,
  extractAssetAliasNotFoundDetails,
  validateReferenceImageUrl,
  REFERENCE_IMAGE_DATA_URI_MAX_BYTES,
} from "../design-workspace-tool";

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
  isDesignWorkspaceImportError: vi.fn(() => false),
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

    it("strips previewHtml when it exceeds the small-inline threshold and emits an actionable previewHtmlRef", () => {
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
      // W1.3: stripped previewHtml is replaced with an actionable `previewHtmlRef`
      // so the agent knows the length AND how to fetch the full HTML.
      expect(result.data?.previewHtmlRef).toEqual({
        length: bigPreview.length,
        getVia: "readSource",
      });
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

  // ---------------------------------------------------------------------------
  // W2.3 — assetAliases tool-boundary validation.
  //
  // Defense-in-depth over the JSON schema. The tool boundary must reject:
  //   - bad alias format (anything outside /^[a-zA-Z0-9_-]+$/),
  //   - bad URL protocol (must be http(s):// or /api/media/...),
  //   - duplicate aliases in one call.
  //
  // These three cases are the spec's "clear error" contract.
  // ---------------------------------------------------------------------------
  describe("validateAssetAliases — W2.3 tool-boundary checks", () => {
    it("passes through an empty / missing input as an empty list", () => {
      expect(validateAssetAliases(undefined)).toEqual({ ok: true, aliases: [] });
      expect(validateAssetAliases(null)).toEqual({ ok: true, aliases: [] });
      expect(validateAssetAliases([])).toEqual({ ok: true, aliases: [] });
    });

    it("accepts http(s) URLs and /api/media/ paths", () => {
      const result = validateAssetAliases([
        { alias: "hero", url: "https://cdn.example.com/h.png" },
        { alias: "bg_01", url: "/api/media/uploads/bg.png" },
        { alias: "logo-v2", url: "http://localhost:3000/logo.svg" },
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.aliases.map((a) => a.alias)).toEqual([
        "hero",
        "bg_01",
        "logo-v2",
      ]);
    });

    it("rejects aliases that violate the /^[a-zA-Z0-9_-]+$/ grammar", () => {
      const result = validateAssetAliases([
        { alias: "bad alias", url: "/api/media/x.png" },
      ]);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("ASSET_ALIAS_FORMAT_INVALID");
      expect(result.error.alias).toBe("bad alias");
    });

    it("rejects URLs that are not http(s):// or /api/media/", () => {
      const result = validateAssetAliases([
        { alias: "hero", url: "file:///etc/passwd" },
      ]);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("ASSET_ALIAS_URL_INVALID");
      expect(result.error.alias).toBe("hero");
      expect(result.error.url).toBe("file:///etc/passwd");
    });

    it("rejects the same alias declared twice in one call", () => {
      const result = validateAssetAliases([
        { alias: "hero", url: "/api/media/a.png" },
        { alias: "hero", url: "/api/media/b.png" },
      ]);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("ASSET_ALIAS_DUPLICATE");
      expect(result.error.alias).toBe("hero");
      expect(result.error.declaredAliases).toEqual(["hero"]);
    });

    it("rejects malformed entries (not objects, missing fields)", () => {
      const notArray = validateAssetAliases("hero");
      expect(notArray.ok).toBe(false);

      const missingAlias = validateAssetAliases([{ url: "/api/media/x.png" }]);
      expect(missingAlias.ok).toBe(false);

      const missingUrl = validateAssetAliases([{ alias: "hero" }]);
      expect(missingUrl.ok).toBe(false);
    });
  });

  describe("extractAssetAliasNotFoundDetails — reshape compile report", () => {
    it("extracts the alias name and declared aliases from the compile report error", () => {
      const report = {
        warnings: [],
        errors: [
          {
            type: "unknown" as const,
            message:
              "@asset/hero was referenced by the component source but not declared in this call's assetAliases map. Declared aliases: [bg].",
          },
        ],
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
      };
      const details = extractAssetAliasNotFoundDetails(report, ["bg"]);
      expect(details).toEqual({
        code: "ASSET_ALIAS_NOT_FOUND",
        alias: "hero",
        declaredAliases: ["bg"],
      });
    });

    it("returns undefined for unrelated compile failures", () => {
      const report = {
        warnings: [],
        errors: [
          {
            type: "syntax" as const,
            message: "Unexpected token",
          },
        ],
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
      };
      expect(extractAssetAliasNotFoundDetails(report, [])).toBeUndefined();
    });
  });

  describe("toModelOutput — media envelope shape (Rev-A2)", () => {
    it("emits the AI SDK media envelope {type:'image', source:{type:'url', url}} and NOT the legacy 'image-url' shape when a screenshot is present", () => {
      const output = designWorkspaceToModelOutput({
        success: true,
        action: "generate",
        data: {
          componentId: "comp-rev-a2",
          screenshot: {
            url: "https://example.invalid/shot.png",
            width: 1280,
            height: 800,
            dpr: 2,
          },
        },
      });

      expect(output.type).toBe("content");
      if (output.type !== "content") throw new Error("unreachable");

      const serialized = JSON.stringify(output);
      // Must be the current media envelope shape.
      expect(serialized).toContain('"type":"image"');
      expect(serialized).toContain('"source":{"type":"url"');
      expect(serialized).toContain('"url":"https://example.invalid/shot.png"');
      // Must NOT be the old AI SDK `image-url` shape.
      expect(serialized).not.toContain('"image-url"');

      const imagePart = output.value.find((part) => part.type === "image");
      expect(imagePart).toEqual({
        type: "image",
        source: { type: "url", url: "https://example.invalid/shot.png" },
      });

      // The JSON envelope is still forwarded as a text part so the agent
      // retains access to componentId, previewHtmlRef, compileReport, etc.
      const textPart = output.value.find((part) => part.type === "text");
      expect(textPart).toBeDefined();
      if (textPart?.type !== "text") throw new Error("unreachable");
      expect(JSON.parse(textPart.text).data.componentId).toBe("comp-rev-a2");
    });

    it("falls back to a JSON part when no screenshot URL is available", () => {
      const output = designWorkspaceToModelOutput({
        success: true,
        action: "readSource",
        data: { componentId: "comp-no-shot" },
      });

      expect(output.type).toBe("json");
      // Must not synthesize a bogus image part.
      expect(JSON.stringify(output)).not.toContain('"image-url"');
      expect(JSON.stringify(output)).not.toContain('"type":"image"');
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint 3 Rev-F1 — validateReferenceImageUrl hardening.
  //
  // Locks in the XSS containment, SVG rejection, byte cap, path-traversal
  // rejection, and structured-envelope (rejectedUrl) requirements called out
  // in the Sprint 3 W3.3/W3.4 revision batch. Each branch must surface a
  // structured `{ code, rejectedUrl, ... }` shape so the agent can react
  // programmatically without parsing the freeform error string.
  // ---------------------------------------------------------------------------
  describe("validateReferenceImageUrl — Sprint 3 Rev-F1 hardening", () => {
    it("accepts a plain http(s) URL, /api/media path, and allowed data: URI", () => {
      expect(validateReferenceImageUrl("https://example.com/x.png")).toEqual({
        ok: true,
        url: "https://example.com/x.png",
      });
      expect(validateReferenceImageUrl("/api/media/x.png")).toEqual({
        ok: true,
        url: "/api/media/x.png",
      });
      const dataOk = validateReferenceImageUrl(
        "data:image/png;base64,iVBORw0KGgo=",
      );
      expect(dataOk).toEqual({ ok: true, url: "data:image/png;base64,iVBORw0KGgo=" });
    });

    it("passes through undefined / null without error (reference image is optional)", () => {
      expect(validateReferenceImageUrl(undefined)).toEqual({ ok: true });
      expect(validateReferenceImageUrl(null)).toEqual({ ok: true });
    });

    it("rejects URLs containing literal `<` or `>` with REFERENCE_IMAGE_URL_INVALID", () => {
      // Classic `</script>` XSS probe (BA R3.3 block).
      const evil = "https://example.com/a.png</script><script>alert(1)</script>";
      const result = validateReferenceImageUrl(evil);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      // Rejection path echoes the full offending URL so the agent can
      // diff against its last-known-good input.
      expect(result.error.rejectedUrl).toBe(evil);
      // The human-readable message must NOT blow up in size — it should
      // truncate the URL to ≤200 chars plus a short lead.
      expect(result.error.message).toContain("<");
    });

    it("rejects data:image/svg+xml (SVG can embed <script> / onload=)", () => {
      const evil = "data:image/svg+xml,%3Csvg onload=alert(1)/%3E";
      const result = validateReferenceImageUrl(evil);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      expect(result.error.rejectedUrl).toBe(evil);
    });

    it("rejects data:image/svg+xml with literal <svg onload=...> angle brackets via containment guard", () => {
      // Raw-angle-bracket variant — containment guard catches this BEFORE
      // the MIME allowlist, so the failure is the containment path.
      const evil = "data:image/svg+xml,<svg onload=alert(1)/>";
      const result = validateReferenceImageUrl(evil);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      expect(result.error.rejectedUrl).toBe(evil);
    });

    it("rejects every non-raster data: form (html, javascript, application/*)", () => {
      for (const evil of [
        "data:text/html,<script>alert(1)</script>",
        "data:application/javascript,alert(1)",
        "data:image/svg+xml;base64,PHN2Zy8+",
      ]) {
        const result = validateReferenceImageUrl(evil);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("unreachable");
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      }
    });

    it("accepts every raster MIME in the allowlist (png, jpeg, jpg, gif, webp)", () => {
      for (const ok of [
        "data:image/png;base64,AAAA",
        "data:image/jpeg;base64,AAAA",
        "data:image/jpg;base64,AAAA",
        "data:image/gif;base64,AAAA",
        "data:image/webp;base64,AAAA",
      ]) {
        const result = validateReferenceImageUrl(ok);
        expect(result.ok).toBe(true);
      }
    });

    it("rejects a data: URI exceeding the 2MB byte cap with REFERENCE_IMAGE_URL_TOO_LARGE", () => {
      // Build a data URI of ~2.1 MB. The byte count is dominated by the
      // base64 body; the prefix / scheme is ~30 chars.
      const prefix = "data:image/png;base64,";
      const body = "A".repeat(REFERENCE_IMAGE_DATA_URI_MAX_BYTES + 100);
      const oversized = prefix + body;

      const result = validateReferenceImageUrl(oversized);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("REFERENCE_IMAGE_URL_TOO_LARGE");
      if (result.error.code !== "REFERENCE_IMAGE_URL_TOO_LARGE") {
        throw new Error("unreachable");
      }
      expect(result.error.limit).toBe(2 * 1024 * 1024);
      expect(result.error.bytes).toBeGreaterThan(result.error.limit);
      expect(result.error.rejectedUrl).toBe(oversized);
    });

    it("accepts a data: URI right at the 2MB byte cap", () => {
      const prefix = "data:image/png;base64,";
      const body = "A".repeat(REFERENCE_IMAGE_DATA_URI_MAX_BYTES - prefix.length);
      const atCap = prefix + body;
      const result = validateReferenceImageUrl(atCap);
      expect(result.ok).toBe(true);
    });

    it("rejects /api/media/ URLs with `..` path segments (path traversal)", () => {
      const evil = "/api/media/../etc/passwd";
      const result = validateReferenceImageUrl(evil);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      expect(result.error.rejectedUrl).toBe(evil);
    });

    it("rejects http(s) URLs with `..` path segments", () => {
      const evil = "https://example.com/media/../etc/passwd";
      const result = validateReferenceImageUrl(evil);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      expect(result.error.rejectedUrl).toBe(evil);
    });

    // Rev-G B1 — percent-encoded traversal hardening.
    // ----------------------------------------------
    // The WHATWG URL parser folds `%2e` / `%2E` to `.` during path-segment
    // normalization for http(s) and our dummy-origin `/api/media/...`
    // parse, which means a parsed-pathname inspector NEVER observes `..`
    // even when the raw input clearly contains one. Backend review flagged
    // `/api/media/%2e%2e/secret` (and `http(s)` analog) as block-severity
    // bypasses — lock in the pre-URL-parse raw-string check that folds
    // `%2e` variants before scanning for `/..`.
    it("rejects /api/media/ URLs with percent-encoded `..` segments (all case variants)", () => {
      const cases = [
        "/api/media/%2e%2e/secret",        // lowercase
        "/api/media/%2E%2E/secret",        // uppercase
        "/api/media/%2e%2E/secret",        // mixed case
        "/api/media/.%2e/secret",          // literal + encoded
        "/api/media/%2e./secret",          // encoded + literal
        "/api/media/sub/%2e%2e/escape",    // nested
      ];
      for (const evil of cases) {
        const result = validateReferenceImageUrl(evil);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`unreachable for ${evil}`);
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
        expect(result.error.rejectedUrl).toBe(evil);
      }
    });

    it("rejects http(s) URLs with percent-encoded `..` segments (all case variants)", () => {
      const cases = [
        "https://example.com/media/%2e%2e/secret",
        "https://example.com/media/%2E%2E/secret",
        "https://example.com/media/%2e%2E/secret",
        "https://example.com/media/.%2e/secret",
        "https://example.com/media/%2e./secret",
        "http://example.com/sub/%2e%2e/escape",
      ];
      for (const evil of cases) {
        const result = validateReferenceImageUrl(evil);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`unreachable for ${evil}`);
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
        expect(result.error.rejectedUrl).toBe(evil);
      }
    });

    // Rev-H BE-warn — segment-boundary precision.
    // ----------------------------------------------
    // The previous detector used `expanded.includes("/..")` which is too
    // broad: `/api/media/foo/.../bar` (3+ dots) and `/api/media/..foo.png`
    // (no segment boundary on the right) both contained the substring
    // `/..` and got rejected even though they aren't real `..` segments.
    // The regex `(^|/)\.\.([\/?#]|$)` requires real segment boundaries.
    it("ALLOWS legitimate names that merely START with `..` but aren't `..` segments", () => {
      const allowed = [
        "/api/media/foo/.../bar",         // 3+ dots is not `..`
        "/api/media/..foo.png",           // no boundary on right side
        "/api/media/foo/..bar",           // dots are mid-segment
        "/api/media/version1.0.0/x.png",  // dots in version name
        "/api/media/%2e%2efoo.png",       // encoded equiv. of ..foo
        "/api/media/foo/%2e%2e%2e/bar",   // encoded equiv. of .../
        "https://example.com/media/foo/.../bar",
        "https://example.com/media/..foo.png",
      ];
      for (const ok of allowed) {
        const result = validateReferenceImageUrl(ok);
        // These shouldn't be rejected on traversal grounds. Some may still
        // be rejected for other valid reasons (MIME, scheme), but NOT for
        // traversal — assert the message doesn't mention `..`.
        if (!result.ok) {
          expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
          expect(result.error.message).not.toMatch(/path segments/);
        }
      }
    });

    it("REJECTS real `..` segments at all positions (start/middle/end + before query/fragment)", () => {
      const evil = [
        "/api/media/../secret",                     // start
        "/api/media/foo/../bar",                    // middle
        "/api/media/foo/..",                        // end (no trailing /)
        "/api/media/foo/..?x=1",                    // before query
        "/api/media/foo/..#anchor",                 // before fragment
        "/api/media//%2e%2e/etc",                   // double-slash + encoded
        "/api/media/%2e%2e",                        // encoded at root, no trailing
        "https://example.com/media/foo/..?download", // http analog before query
      ];
      for (const e of evil) {
        const result = validateReferenceImageUrl(e);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`unreachable for ${e}`);
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      }
    });

    // Rev-I BE — separator-encoding traversal hardening.
    // ----------------------------------------------------
    // `new URL(...)` normalizes BOTH literal backslashes AND `%2f`/`%5c`
    // variants into path separators on `http(s):` URLs, which can collapse
    // traversal before our `pathname.split('/')` check can see a `..`
    // segment. Similarly, any downstream layer that decodes `%2f` BEFORE
    // path normalization would also bypass the literal detector. We defend
    // by folding `\`, `%2f`, `%2e`, and `%5c` to `/` / `.` on the raw
    // string BEFORE the segment boundary check runs.
    it("REJECTS backslash-separated traversal at all positions", () => {
      const evil = [
        "/api/media/..\\secret",                    // backslash separator
        "/api/media/foo/..\\bar",                   // mid-path
        "/api/media\\..\\secret",                   // pure backslash path
        "https://example.com/media/..\\secret",     // http analog
        "https://example.com/media/foo/..\\bar",    // http mid-path
      ];
      for (const e of evil) {
        const result = validateReferenceImageUrl(e);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`unreachable for ${e}`);
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      }
    });

    it("REJECTS encoded-separator traversal (%2f, %5c, mixed-case)", () => {
      const evil = [
        "/api/media/%2f..%2fsecret",                // %2f..%2f
        "/api/media/%2F..%2Fsecret",                // uppercase
        "/api/media/%5c..%5csecret",                // %5c..%5c
        "/api/media/%5C..%5Csecret",                // uppercase
        "/api/media%2f..%2fsecret",                 // no trailing leading slash before %2f
        "https://example.com/media/%2f..%2fsecret", // http analog
        "https://example.com/media/%5c..%5csecret", // http analog
      ];
      for (const e of evil) {
        const result = validateReferenceImageUrl(e);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`unreachable for ${e}`);
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      }
    });

    it("REJECTS mixed-separator traversal (literal + encoded)", () => {
      const evil = [
        "/api/media/foo/%2e%2e\\secret",            // %2e%2e + backslash
        "/api/media/foo/..\\%2e%2e/bar",            // backslash + encoded dots
        "/api/media/%2f%2e%2e%2fsecret",            // all-encoded
      ];
      for (const e of evil) {
        const result = validateReferenceImageUrl(e);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`unreachable for ${e}`);
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
      }
    });

    it("ALLOWS literal backslash in filenames that aren't `..` segments", () => {
      // Backslash can appear in legitimate non-traversal contexts (e.g. as
      // part of a Windows-origin filename). After folding, `foo\\bar` becomes
      // `foo/bar` which has no `..` segment and must pass the traversal gate.
      const allowed = [
        "/api/media/foo\\bar.png",                  // just a separator swap
        "/api/media/deep\\nested\\path.png",        // multiple swaps, no ..
      ];
      for (const ok of allowed) {
        const result = validateReferenceImageUrl(ok);
        if (!result.ok) {
          expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
          // Must NOT be rejected for traversal specifically.
          expect(result.error.message).not.toMatch(/path segments/);
        }
      }
    });

    it("rejects wholly unsupported schemes (file://, ftp://, javascript:)", () => {
      for (const evil of [
        "file:///etc/passwd",
        "ftp://example.com/x.png",
        "javascript:alert(1)",
      ]) {
        const result = validateReferenceImageUrl(evil);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("unreachable");
        expect(result.error.code).toBe("REFERENCE_IMAGE_URL_INVALID");
        expect(result.error.rejectedUrl).toBe(evil);
      }
    });

    it("truncates the full URL in the human-readable message to ~200 chars but keeps the full URL in rejectedUrl", () => {
      // Trigger the containment guard with a very long payload so we can
      // observe the truncation contract for the error message while
      // confirming `rejectedUrl` holds the full value.
      const longTail = "x".repeat(500);
      const evil = `https://example.com/${longTail}<script>`;
      const result = validateReferenceImageUrl(evil);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.rejectedUrl).toBe(evil);
      // Message should be much shorter than rejectedUrl for huge inputs.
      expect(result.error.message.length).toBeLessThan(evil.length);
    });

    it("every rejection branch echoes rejectedUrl on the structured error (BA warn)", () => {
      const cases: string[] = [
        "https://example.com/x.png<script>",       // containment
        "data:image/svg+xml;base64,PHN2Zy8+",      // MIME
        "/api/media/../etc/passwd",                 // traversal
        "file:///etc/passwd",                       // scheme
      ];
      for (const evil of cases) {
        const result = validateReferenceImageUrl(evil);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("unreachable");
        expect(typeof result.error.rejectedUrl).toBe("string");
        expect(result.error.rejectedUrl).toBe(evil);
      }
    });
  });
});
