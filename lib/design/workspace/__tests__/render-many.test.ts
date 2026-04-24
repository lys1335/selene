/**
 * W3.4 — `renderMany` primitive tests.
 *
 * Covers the emitted preview entry source for both the default single-
 * render path (unchanged from pre-W3.4) and the new auto-grid path.
 * Also locks in the JSON-for-JS-string-literal encoder that defuses
 * the JSX-injection and `</script>`-escape hazards called out in the
 * W3.4 spec.
 *
 * These tests exercise the pure helpers in `compiler.ts` — no esbuild,
 * no Tailwind, no DOM — so they run in millisecond-scale.
 */

import { describe, it, expect } from "vitest";
import {
  createPreviewEntrySource,
  encodeJsonForJsStringLiteral,
  RENDER_MANY_MAX_CELLS,
  type RenderManyCell,
} from "../compiler";

describe("createPreviewEntrySource — W3.4", () => {
  it("single-render path (no renderMany) still emits the default `<Component />` mount", () => {
    const source = createPreviewEntrySource();
    expect(source).toContain("React.createElement(Component)");
    // The grid sentinels must NOT appear in the single-render path.
    expect(source).not.toContain("data-design-cell-index");
    expect(source).not.toContain("data-design-render-many");
    expect(source).not.toContain("__renderManySpecs__");
  });

  it("empty renderMany array falls through to the single-render path", () => {
    const source = createPreviewEntrySource([]);
    expect(source).toContain("React.createElement(Component)");
    expect(source).not.toContain("data-design-cell-index");
  });

  it("emits one data-design-cell-index per cell and a CSS grid wrapper", () => {
    const cells: RenderManyCell[] = [
      { props: { variant: "primary" }, label: "Primary" },
      { props: { variant: "secondary" } },
      { props: { variant: "ghost" }, label: "Ghost", className: "bg-muted p-4" },
    ];
    const source = createPreviewEntrySource(cells);

    // Grid wrapper + shape.
    expect(source).toContain("'data-design-render-many': 'true'");
    expect(source).toContain("display: 'grid'");
    expect(source).toContain("gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))'");
    expect(source).toContain("gap: '24px'");

    // The generated code has ONE literal `data-design-cell-index` assignment
    // inside `__renderManyCell__` (the index value comes from spec.index at
    // runtime). What matters is that it stamps the attribute on each cell.
    expect(source).toContain("'data-design-cell-index': spec.index");

    // The runtime spec array carries unique indexes 0..N-1, which
    // guarantees unique cell-index attributes when rendered.
    // Note: the JSON is embedded inside a JS string literal via
    // `encodeJsonForJsStringLiteral`, so every `"` in the JSON appears
    // as `\"` in the entry source.
    expect(source).toContain('\\"index\\":0');
    expect(source).toContain('\\"index\\":1');
    expect(source).toContain('\\"index\\":2');

    // Labels appear in the JSON-embedded spec (pre-render).
    expect(source).toContain('\\"label\\":\\"Primary\\"');
    expect(source).toContain('\\"label\\":\\"Ghost\\"');
    // Missing label encodes as null (not the string "undefined").
    expect(source).toContain('\\"label\\":null');

    // className passed through.
    expect(source).toContain('\\"className\\":\\"bg-muted p-4\\"');
  });

  it("defuses JSX injection: special chars in prop values are embedded as JSON strings, not attributes", () => {
    // The classic JSX-attribute-injection payload. If these characters
    // were embedded as raw attribute values the entry source would be
    // syntactically broken or could escape the component prop bag.
    const cells: RenderManyCell[] = [
      {
        props: {
          title: 'quoted "value" with </script> and >>><<< brackets',
          multiline: "line1\nline2\r\ntab\there",
          unicode: "emoji \u{1F680} and lsep\u2028 psep\u2029",
        },
      },
    ];
    const source = createPreviewEntrySource(cells);

    // 1. No raw `"` characters leak out to the JS literal (JSON.stringify
    //    encoded the inner quotes as `\"`, and `encodeJsonForJsStringLiteral`
    //    escaped those again as `\\\"`).
    //
    // Grep for the raw payload — it must NOT appear verbatim in the
    // generated source (it would mean the quote escaping failed).
    expect(source).not.toContain('quoted "value" with');

    // 2. `</script>` must be neutered so the inline script tag in the
    //    preview HTML cannot be prematurely closed by a prop value.
    expect(source).not.toContain("</script>");

    // 3. U+2028 / U+2029 must be escaped — otherwise the JS parser
    //    treats them as line terminators and the embedded literal
    //    breaks on the very first newline-flavoured character.
    expect(source).not.toMatch(/[\u2028\u2029]/);

    // 4. The entry source must still be parseable as JS — there must be
    //    a single `JSON.parse("...")` call with a closed string literal.
    //    A simple integrity check: the JSON.parse invocation must terminate
    //    with `");` and not be followed by dangling garbage.
    expect(source).toMatch(/var __renderManySpecs__ = JSON\.parse\("[^\n]*"\);/);
  });

  it("each cell wires through spec.props so the component receives the full prop bag", () => {
    const cells: RenderManyCell[] = [{ props: { a: 1, b: [2, 3], c: { nested: true } } }];
    const source = createPreviewEntrySource(cells);
    expect(source).toContain("React.createElement(Component, spec.props || {})");
  });

  it("wraps each cell in __SeleneCellBoundary__ so one cell's throw does not blank the page", () => {
    const cells: RenderManyCell[] = [{ props: {} }, { props: {} }];
    const source = createPreviewEntrySource(cells);
    expect(source).toContain("__SeleneCellBoundary__");
  });
});

describe("encodeJsonForJsStringLiteral — W3.4 security helper", () => {
  it("round-trips a plain object through JSON.parse", () => {
    const value = { a: 1, b: "hi", c: [true, null] };
    const encoded = encodeJsonForJsStringLiteral(value);
    // Build the same JS expression the runtime would evaluate and verify it.
    const parsed = JSON.parse(JSON.parse(`"${encoded}"`));
    expect(parsed).toEqual(value);
  });

  it("escapes `</script>` so inline-script tags cannot be terminated by a payload", () => {
    const encoded = encodeJsonForJsStringLiteral({ html: "<p>ok</p></script><script>x</script>" });
    expect(encoded).not.toContain("</script>");
    expect(encoded).not.toContain("</p>");
    // Still round-trips.
    const parsed = JSON.parse(JSON.parse(`"${encoded}"`));
    expect(parsed).toEqual({ html: "<p>ok</p></script><script>x</script>" });
  });

  it("escapes U+2028 / U+2029 so the embedded string literal stays on one line", () => {
    const encoded = encodeJsonForJsStringLiteral({ s: "a\u2028b\u2029c" });
    expect(encoded).not.toMatch(/[\u2028\u2029]/);
    const parsed = JSON.parse(JSON.parse(`"${encoded}"`));
    expect(parsed).toEqual({ s: "a\u2028b\u2029c" });
  });

  it("escapes backslashes and double quotes for safe JS-string embedding", () => {
    const encoded = encodeJsonForJsStringLiteral({ s: 'back\\slash and "quote"' });
    const parsed = JSON.parse(JSON.parse(`"${encoded}"`));
    expect(parsed).toEqual({ s: 'back\\slash and "quote"' });
  });

  it("escapes raw newlines (not just the JSON `\\n` escape sequence)", () => {
    const encoded = encodeJsonForJsStringLiteral({ s: "line1\nline2" });
    // Physical newlines in the encoded output would break the JS literal.
    expect(encoded).not.toContain("\n");
    expect(encoded).not.toContain("\r");
    const parsed = JSON.parse(JSON.parse(`"${encoded}"`));
    expect(parsed).toEqual({ s: "line1\nline2" });
  });

  it("handles an empty object", () => {
    expect(encodeJsonForJsStringLiteral({})).toBe("{}");
  });
});

describe("RENDER_MANY_MAX_CELLS constant — W3.4", () => {
  it("defaults to 24 as specified in the W3.4 spec", () => {
    expect(RENDER_MANY_MAX_CELLS).toBe(24);
  });
});
