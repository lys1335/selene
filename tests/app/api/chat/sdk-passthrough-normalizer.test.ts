import { describe, expect, it } from "vitest";
import { normalizeSdkPassthroughOutput } from "@/app/api/chat/sdk-passthrough-normalizer";

describe("normalizeSdkPassthroughOutput", () => {
  it("normalizes calculator discovery string outputs into canonical success objects", () => {
    const output = normalizeSdkPassthroughOutput(
      "mcp__selene-platform__calculator",
      'Tool "calculator" requires discovery first. Call searchTools("calculator") to activate it, then retry.',
      { expression: "14 + 5" }
    );

    expect(output.status).toBe("success");
    expect(output.content).toContain('Tool "calculator" requires discovery first');
    expect(typeof output.summary).toBe("string");
  });

  it("unwraps MCP text-wrapped calculator JSON into structured numeric result", () => {
    const wrapped = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            expression: "14 + 5",
            result: 19,
            type: "number",
          }),
        },
      ],
    };

    const output = normalizeSdkPassthroughOutput(
      "mcp__selene-platform__calculator",
      wrapped,
      { expression: "14 + 5" }
    );

    expect(output.status).toBe("success");
    expect(output.success).toBe(true);
    expect(output.expression).toBe("14 + 5");
    expect(output.result).toBe(19);
    expect(output.type).toBe("number");
  });

  it("unwraps MCP text-wrapped searchTools JSON and preserves query/results", () => {
    const wrapped = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            query: "calculator",
            results: [{ name: "calculator", displayName: "Calculator", isAvailable: true }],
            message: 'Found 1 result(s) matching "calculator". 1 tool(s).',
          }),
        },
      ],
    };

    const output = normalizeSdkPassthroughOutput(
      "mcp__selene-platform__searchTools",
      wrapped,
      { query: "calculator" }
    );

    expect(output.status).toBe("success");
    expect(output.query).toBe("calculator");
    expect(Array.isArray(output.results)).toBe(true);
    expect((output.results as Array<{ name?: string }>)[0]?.name).toBe("calculator");
    expect(output.message).toContain("Found 1 result");
  });
  it("unwraps MCP text-wrapped designWorkspace results into canonical component payloads", () => {
    const wrapped = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            action: "generate",
            data: {
              componentId: "cmp_123",
              code: "<div>Hello</div>",
              name: "Hello Card",
              message: "Component created successfully.",
            },
          }),
        },
      ],
    };

    const output = normalizeSdkPassthroughOutput(
      "mcp__selene-platform__designWorkspace",
      wrapped,
      { action: "generate", prompt: "hello card" }
    );

    expect(output.status).toBe("success");
    expect(output.success).toBe(true);
    expect(output.action).toBe("generate");
    // previewHtml is no longer included in tool results — stripped at source
    // to prevent 100K+ bundled JS from bloating responses. Client compiles on demand.
    expect(output.data).toEqual({
      componentId: "cmp_123",
      code: "<div>Hello</div>",
      name: "Hello Card",
      message: "Component created successfully.",
    });
  });

});

