/** @vitest-environment jsdom */

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => ((key: string) => key),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
}));

import { ExpandAllToolsButton } from "@/components/assistant-ui/expand-all-tools-button";
import { ToolExpansionProvider, useToolExpansion } from "@/components/assistant-ui/tool-expansion-context";

function ExpansionStateProbe() {
  const ctx = useToolExpansion();
  return createElement(
    "output",
    {
      "data-testid": "expansion-state",
      "data-mode": ctx?.signal.mode ?? "missing",
      "data-counter": String(ctx?.signal.counter ?? -1),
    },
    `${ctx?.signal.mode ?? "missing"}:${ctx?.signal.counter ?? -1}`,
  );
}

function Harness() {
  return createElement(
    ToolExpansionProvider,
    null,
    createElement("textarea", { "data-testid": "composer" }),
    createElement(ExpandAllToolsButton),
    createElement(ExpansionStateProbe),
  );
}

describe("ExpandAllToolsButton keyboard shortcut", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root.render(createElement(Harness));
    });
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it("toggles tool expansion when Cmd+Shift+E is pressed from the focused composer", () => {
    const composer = container.querySelector("textarea");
    const state = container.querySelector("[data-testid='expansion-state']");

    expect(composer).toBeTruthy();
    expect(state?.getAttribute("data-mode")).toBe("collapse");
    expect(state?.getAttribute("data-counter")).toBe("0");

    composer?.focus();
    expect(document.activeElement).toBe(composer);

    const event = new KeyboardEvent("keydown", {
      key: "E",
      shiftKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    flushSync(() => {
      composer?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(state?.getAttribute("data-mode")).toBe("expand");
    expect(state?.getAttribute("data-counter")).toBe("1");
  });

  it("toggles tool expansion when Ctrl+Shift+E is pressed (non-Mac platforms)", () => {
    const composer = container.querySelector("textarea");
    const state = container.querySelector("[data-testid='expansion-state']");

    composer?.focus();

    const event = new KeyboardEvent("keydown", {
      key: "E",
      shiftKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    flushSync(() => {
      composer?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(state?.getAttribute("data-mode")).toBe("expand");
    expect(state?.getAttribute("data-counter")).toBe("1");
  });

  it("does not toggle tool expansion for bare Shift+E (regression: must not block typing capital E)", () => {
    const composer = container.querySelector("textarea");
    const state = container.querySelector("[data-testid='expansion-state']");

    composer?.focus();

    const event = new KeyboardEvent("keydown", {
      key: "E",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    flushSync(() => {
      composer?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(state?.getAttribute("data-mode")).toBe("collapse");
    expect(state?.getAttribute("data-counter")).toBe("0");
  });

  it("does not toggle tool expansion for normal composer typing", () => {
    const composer = container.querySelector("textarea");
    const state = container.querySelector("[data-testid='expansion-state']");

    composer?.focus();

    const event = new KeyboardEvent("keydown", {
      key: "e",
      bubbles: true,
      cancelable: true,
    });

    flushSync(() => {
      composer?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(state?.getAttribute("data-mode")).toBe("collapse");
    expect(state?.getAttribute("data-counter")).toBe("0");
  });
});
