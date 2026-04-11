import { describe, it, expect } from "vitest";
import {
  buildInspectMessageContext,
  sanitizeInspectMessageContext,
  buildInspectPromptText,
  formatInspectSelectionLabel,
  inspectSelectionFromElement,
  getInspectSelectionKey,
  MAX_INSPECT_SELECTIONS,
  type InspectMessageContext,
} from "@/lib/design/workspace/inspect-context";
import type { InspectedElement } from "@/lib/design/workspace/types";

function makeElement(overrides: Partial<InspectedElement> = {}): InspectedElement {
  return {
    tagName: "div",
    id: "",
    className: "flex items-center",
    textContent: "Hello world",
    selector: "div > div:nth-of-type(2)",
    boundingRect: { x: 10, y: 20, width: 200, height: 100 },
    computedStyles: {
      width: "200px",
      height: "100px",
      padding: "0px",
      margin: "0px",
      display: "flex",
      position: "relative",
      color: "rgb(0,0,0)",
      backgroundColor: "rgb(255,255,255)",
      fontSize: "16px",
      fontFamily: "sans-serif",
    },
    ...overrides,
  };
}

describe("inspectSelectionFromElement", () => {
  it("normalizes an InspectedElement into an InspectSelection", () => {
    const el = makeElement({ tagName: "BUTTON", id: "submit-btn", className: "btn btn-primary px-4" });
    const sel = inspectSelectionFromElement(el);
    expect(sel.tagName).toBe("button");
    expect(sel.id).toBe("submit-btn");
    expect(sel.classes).toEqual(["btn", "btn-primary", "px-4"]);
    expect(sel.bounds.width).toBe(200);
  });

  it("caps text and classes at configured limits", () => {
    const el = makeElement({
      textContent: "A".repeat(300),
      className: "a b c d e f g h i j",
    });
    const sel = inspectSelectionFromElement(el);
    // clampText adds "..." suffix so max is MAX_TEXT_LENGTH + 2
    expect(sel.textContent.length).toBeLessThanOrEqual(163);
    expect(sel.classes.length).toBeLessThanOrEqual(6);
  });
});

describe("buildInspectMessageContext", () => {
  it("returns null for empty selections", () => {
    const ctx = buildInspectMessageContext({ selectedElements: [], component: null });
    expect(ctx).toBeNull();
  });

  it("builds context with component metadata", () => {
    const ctx = buildInspectMessageContext({
      selectedElements: [makeElement()],
      component: { id: "comp-1", name: "Hero Section" },
      sessionId: "sess-abc",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.source).toBe("design-workspace-inspector");
    expect(ctx!.componentName).toBe("Hero Section");
    expect(ctx!.sessionId).toBe("sess-abc");
    expect(ctx!.elements).toHaveLength(1);
  });

  it("caps at MAX_INSPECT_SELECTIONS", () => {
    const elements = Array.from({ length: 20 }, (_, i) =>
      makeElement({ selector: `div:nth-of-type(${i + 1})` }),
    );
    const ctx = buildInspectMessageContext({ selectedElements: elements, component: null });
    expect(ctx!.elements.length).toBeLessThanOrEqual(MAX_INSPECT_SELECTIONS);
  });
});

describe("sanitizeInspectMessageContext", () => {
  it("returns null for non-objects", () => {
    expect(sanitizeInspectMessageContext(null)).toBeNull();
    expect(sanitizeInspectMessageContext("string")).toBeNull();
    expect(sanitizeInspectMessageContext(42)).toBeNull();
  });

  it("returns null for missing/empty elements", () => {
    expect(sanitizeInspectMessageContext({ elements: [] })).toBeNull();
    expect(sanitizeInspectMessageContext({})).toBeNull();
  });

  it("sanitizes a valid context round-trip", () => {
    const original = buildInspectMessageContext({
      selectedElements: [makeElement(), makeElement({ selector: "span.title", tagName: "span" })],
      component: { id: "c1", name: "Card" },
    });
    const sanitized = sanitizeInspectMessageContext(original);
    expect(sanitized).not.toBeNull();
    expect(sanitized!.elements).toHaveLength(2);
    expect(sanitized!.componentName).toBe("Card");
  });

  it("strips invalid elements from a partially corrupt payload", () => {
    const sanitized = sanitizeInspectMessageContext({
      elements: [
        { tagName: "div", selector: "div.ok", className: "" },
        { tagName: "", selector: "" }, // invalid
        null,
      ],
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.elements).toHaveLength(1);
  });
});

describe("buildInspectPromptText", () => {
  it("returns null for null context", () => {
    expect(buildInspectPromptText(null)).toBeNull();
  });

  it("formats a readable prompt block", () => {
    const ctx = buildInspectMessageContext({
      selectedElements: [makeElement({ tagName: "button", className: "btn-primary", textContent: "Submit" })],
      component: { id: "c1", name: "Form" },
    });
    const text = buildInspectPromptText(ctx);
    expect(text).toContain("[Inspect Focus]");
    expect(text).toContain("Form");
    expect(text).toContain("button");
    expect(text).toContain("selector:");
    expect(text).toContain("bounds:");
  });

  it("includes multiple elements", () => {
    const ctx = buildInspectMessageContext({
      selectedElements: [
        makeElement({ selector: "div.a" }),
        makeElement({ selector: "span.b", tagName: "span" }),
      ],
      component: null,
    });
    const text = buildInspectPromptText(ctx);
    expect(text).toContain("Selected elements: 2");
    expect(text).toContain("1.");
    expect(text).toContain("2.");
  });
});

describe("formatInspectSelectionLabel", () => {
  it("formats a chip-style label", () => {
    const label = formatInspectSelectionLabel({
      tagName: "button",
      textContent: "Submit",
      classes: ["btn", "primary"],
    });
    expect(label).toContain("<button>");
    expect(label).toContain(".btn");
    expect(label).toContain('"Submit"');
  });

  it("handles empty text/classes gracefully", () => {
    const label = formatInspectSelectionLabel({
      tagName: "div",
      textContent: "",
      classes: [],
    });
    expect(label).toBe("<div>");
  });
});

describe("getInspectSelectionKey", () => {
  it("returns selector as key", () => {
    expect(getInspectSelectionKey({ selector: "div.foo > span" })).toBe("div.foo > span");
  });
});
