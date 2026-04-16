import { describe, it, expect } from "vitest";
import {
  applyPatches,
  findUnclosedJsxTag,
  validateJsxBalance,
  type PatchOp,
} from "../../../../lib/design/workspace/patch-logic";

// ---------------------------------------------------------------------------
// findUnclosedJsxTag — backwards-compatible tests
// ---------------------------------------------------------------------------

describe("findUnclosedJsxTag", () => {
  it("returns null for balanced JSX", () => {
    const code = `
      export default function App() {
        return (
          <Container className="root">
            <Header />
            <Main>
              <Paragraph>Hello</Paragraph>
            </Main>
          </Container>
        );
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("returns null for self-closing tags", () => {
    const code = `
      export default function App() {
        return <Image src="test.png" />;
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("detects unclosed wrapping component", () => {
    const code = `
      export default function App() {
        return (
          <Wrapper className="outer">
            <Content className="inner">
              <Text>Hello</Text>
            </Content>
        );
      }
    `;
    expect(findUnclosedJsxTag(code)).toBe("Wrapper");
  });

  it("returns null when tags in strings are ignored", () => {
    const code = `
      export default function App() {
        const html = "<Unclosed> not a real tag";
        return <Container><Text>Hello</Text></Container>;
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("returns null when tags in comments are ignored", () => {
    const code = `
      export default function App() {
        // <Unclosed> tag in comment
        /* <Another> unclosed in block comment */
        return <Container><Text>Hello</Text></Container>;
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("detects unclosed custom component by name", () => {
    const code = `
      export default function App() {
        return (
          <FlexContainer>
            <Card>
              <Text>Hello</Text>
            </Card>
        );
      }
    `;
    expect(findUnclosedJsxTag(code)).toBe("FlexContainer");
  });

  it("handles deeply nested balanced JSX", () => {
    const code = `
      export default function App() {
        return (
          <Layout>
            <Header>
              <Nav>
                <Link>Home</Link>
              </Nav>
            </Header>
            <Main>
              <Section>
                <Card>
                  <Title>Test</Title>
                </Card>
              </Section>
            </Main>
            <Footer />
          </Layout>
        );
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("handles template literals with JSX-like content", () => {
    const code = `
      export default function App() {
        const tmpl = \`<Broken> inside template\`;
        return <Container>OK</Container>;
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  // New tests for improved handling
  it("handles TypeScript generics like useState<Type>", () => {
    const code = `
      export default function App() {
        const [state, setState] = useState<SceneState>({ x: 0 });
        const ref = useRef<HTMLDivElement>(null);
        return <Container>OK</Container>;
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("handles type annotations with generics", () => {
    const code = `
      export default function App() {
        const items: Array<Element> = [];
        const map: Record<string, FC<Props>> = {};
        return <Container>OK</Container>;
      }
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });

  it("handles function declarations with type parameters", () => {
    const code = `
      function Component<T extends Record<string, unknown>>(props: T) {
        return <Container>OK</Container>;
      }
      export default Component;
    `;
    expect(findUnclosedJsxTag(code)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateJsxBalance — extended validation
// ---------------------------------------------------------------------------

describe("validateJsxBalance", () => {
  it("returns valid for balanced code", () => {
    const result = validateJsxBalance(`<Card><Title>Hi</Title></Card>`);
    expect(result.valid).toBe(true);
  });

  it("returns invalid with tag name for unbalanced code", () => {
    const result = validateJsxBalance(`<Card><Title>Hi</Title>`);
    expect(result.valid).toBe(false);
    expect(result.unclosedTag).toBe("Card");
  });

  it("handles code with generics that look like JSX", () => {
    const code = `
      const x = useState<MyState>(null);
      const y: Record<string, FC<Props>> = {};
      return <Card>OK</Card>;
    `;
    const result = validateJsxBalance(code);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyPatches — exact matching
// ---------------------------------------------------------------------------

describe("applyPatches — exact matching", () => {
  it("applies a single exact patch", () => {
    const source = `<Card>\n  <Title>Hello</Title>\n</Card>`;
    const result = applyPatches(source, [
      { oldString: "<Title>Hello</Title>", newString: "<Title>World</Title>" },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toContain("<Title>World</Title>");
    expect(result.totalReplacements).toBe(1);
  });

  it("fails when oldString not found", () => {
    const source = `<Card>Hello</Card>`;
    const result = applyPatches(source, [
      { oldString: "<Title>Missing</Title>", newString: "<Title>New</Title>" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("fails when multiple matches without replaceAll", () => {
    const source = `<Text>A</Text>\n<Text>B</Text>`;
    const result = applyPatches(source, [
      { oldString: "<Text>", newString: "<Span>" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("2 times");
  });

  it("replaces all occurrences with replaceAll", () => {
    const source = `foo bar foo baz foo`;
    const result = applyPatches(source, [
      { oldString: "foo", newString: "qux", replaceAll: true },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toBe("qux bar qux baz qux");
    expect(result.totalReplacements).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// applyPatches — fuzzy matching
// ---------------------------------------------------------------------------

describe("applyPatches — fuzzy matching", () => {
  it("matches when indentation differs (2-space vs 4-space)", () => {
    const source = `export default function App() {
  return (
    <Card>
      <Title>Hello</Title>
    </Card>
  );
}`;

    // LLM sends with 4-space indentation instead of 2-space
    const result = applyPatches(source, [
      {
        oldString: `    <Card>\n        <Title>Hello</Title>\n    </Card>`,
        newString: `    <Card>\n        <Title>World</Title>\n    </Card>`,
      },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toContain("<Title>World</Title>");
    expect(result.fuzzyMatched).toEqual([0]);
  });

  it("matches when tabs vs spaces differ", () => {
    const source = `  <Container>\n    <Text>Hi</Text>\n  </Container>`;

    // LLM uses tabs
    const result = applyPatches(source, [
      {
        oldString: `\t<Container>\n\t\t<Text>Hi</Text>\n\t</Container>`,
        newString: `\t<Container>\n\t\t<Text>Bye</Text>\n\t</Container>`,
      },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toContain("<Text>Bye</Text>");
    expect(result.fuzzyMatched).toEqual([0]);
  });

  it("re-indents newString to match original file indentation", () => {
    const source = `        <Card>\n          <Title>Hello</Title>\n        </Card>`;

    // LLM sends with 0 indentation
    const result = applyPatches(source, [
      {
        oldString: `<Card>\n  <Title>Hello</Title>\n</Card>`,
        newString: `<Card>\n  <Title>World</Title>\n  <Subtitle>Sub</Subtitle>\n</Card>`,
      },
    ]);
    expect(result.success).toBe(true);
    // The result should have the original 8-space base indentation
    expect(result.code).toContain("        <Card>");
    expect(result.code).toContain("          <Title>World</Title>");
    expect(result.code).toContain("          <Subtitle>Sub</Subtitle>");
    expect(result.code).toContain("        </Card>");
  });

  it("provides hint when no match found at all", () => {
    const source = `<Card>\n  <Title>Hello</Title>\n</Card>`;
    const result = applyPatches(source, [
      { oldString: "<Nonexistent>Missing</Nonexistent>", newString: "<New />" },
    ]);
    expect(result.success).toBe(false);
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain("does not appear");
  });

  it("provides hint with partial match info", () => {
    const source = `<Card>\n  <Title>Hello</Title>\n  <Body>Content</Body>\n</Card>`;
    const result = applyPatches(source, [
      {
        oldString: "<Card>\n  <Title>Hello</Title>\n  <Body>WRONG</Body>",
        newString: "<Card>\n  <Title>New</Title>\n  <Body>New</Body>",
      },
    ]);
    expect(result.success).toBe(false);
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain("Partial match");
    expect(result.hint).toContain("Diverges");
  });
});

// ---------------------------------------------------------------------------
// applyPatches — multi-patch sequential application
// ---------------------------------------------------------------------------

describe("applyPatches — multi-patch", () => {
  it("wraps content with opening and closing tags via two patches", () => {
    const source = `export default function App() {
  return (
    <Card>
      <Title>Hello</Title>
    </Card>
  );
}`;

    const result = applyPatches(source, [
      {
        oldString: "    <Card>",
        newString: "    <Wrapper>\n      <Card>",
      },
      {
        oldString: "    </Card>",
        newString: "      </Card>\n    </Wrapper>",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.code).toContain("<Wrapper>");
    expect(result.code).toContain("</Wrapper>");
    expect(findUnclosedJsxTag(result.code)).toBeNull();
  });

  it("single wide patch also works for wrapping", () => {
    const source = `export default function App() {
  return (
    <Card>
      <Title>Hello</Title>
    </Card>
  );
}`;

    const result = applyPatches(source, [
      {
        oldString: `    <Card>
      <Title>Hello</Title>
    </Card>`,
        newString: `    <Wrapper>
      <Card>
        <Title>Hello</Title>
      </Card>
    </Wrapper>`,
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.code).toContain("<Wrapper>");
    expect(result.code).toContain("</Wrapper>");
    expect(findUnclosedJsxTag(result.code)).toBeNull();
  });

  it("detects when second patch fails because first changed the source", () => {
    const source = "aaa bbb ccc";
    const result = applyPatches(source, [
      { oldString: "bbb", newString: "ddd" },
      { oldString: "bbb", newString: "eee" }, // bbb no longer exists
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("patches[1]");
  });

  it("replaceAll works in multi-patch mode", () => {
    const source = "foo bar foo baz foo";
    const result = applyPatches(source, [
      { oldString: "foo", newString: "qux", replaceAll: true },
    ]);
    expect(result.code).toBe("qux bar qux baz qux");
  });

  it("second patch can use fuzzy matching after first patch modifies source", () => {
    const source = `  <Card>\n    <Title>A</Title>\n    <Body>B</Body>\n  </Card>`;

    const result = applyPatches(source, [
      { oldString: "<Title>A</Title>", newString: "<Title>New</Title>" },
      // This one has wrong indentation — should fuzzy match
      {
        oldString: "      <Body>B</Body>",
        newString: "      <Body>Updated</Body>",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.code).toContain("<Title>New</Title>");
    expect(result.code).toContain("<Body>Updated</Body>");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("applyPatches — edge cases", () => {
  it("handles empty newString (deletion)", () => {
    const source = `<Card>\n  <Title>Hello</Title>\n  <Subtitle>Sub</Subtitle>\n</Card>`;
    const result = applyPatches(source, [
      { oldString: "  <Subtitle>Sub</Subtitle>\n", newString: "" },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).not.toContain("Subtitle");
  });

  it("handles patches that add new lines", () => {
    const source = `<Card>\n</Card>`;
    const result = applyPatches(source, [
      { oldString: "<Card>\n</Card>", newString: "<Card>\n  <Title>New</Title>\n</Card>" },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toContain("<Title>New</Title>");
  });

  it("preserves content outside the patched area", () => {
    const source = `// Header comment\nimport React from 'react';\n\nexport default function App() {\n  return <Card>Hello</Card>;\n}`;
    const result = applyPatches(source, [
      { oldString: "<Card>Hello</Card>", newString: "<Card>World</Card>" },
    ]);
    expect(result.success).toBe(true);
    expect(result.code).toContain("// Header comment");
    expect(result.code).toContain("import React from 'react';");
    expect(result.code).toContain("<Card>World</Card>");
  });
});
