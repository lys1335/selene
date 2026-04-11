import { describe, it, expect } from "vitest";

/**
 * findUnclosedJsxTag is copied here for unit testing because importing
 * from the design-workspace-tool module pulls in heavy dependencies
 * (DB, esbuild, etc.) that aren't available in the test environment.
 * The canonical implementation lives in lib/ai/tools/design-workspace-tool.ts.
 */
function findUnclosedJsxTag(code: string): string | null {
  const stripped = code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  const tagPattern = /<\/?([A-Z][A-Za-z0-9.]*)[^>]*?\/?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(stripped)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];

    if (fullMatch.endsWith("/>")) continue;

    if (fullMatch.startsWith("</")) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      }
    } else {
      stack.push(tagName);
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] : null;
}

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
});

describe("multi-patch sequential application", () => {
  // Simulate the sequential patch application logic from handlePatch

  function applyPatches(
    source: string,
    patches: Array<{ oldString: string; newString: string; replaceAll?: boolean }>,
  ): { code: string; error?: string } {
    let code = source;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const occurrences = code.split(p.oldString).length - 1;
      if (occurrences === 0) {
        return { code, error: `patches[${i}]: oldString not found` };
      }
      code = p.replaceAll
        ? code.split(p.oldString).join(p.newString)
        : code.replace(p.oldString, p.newString);
    }
    return { code };
  }

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

    expect(result.error).toBeUndefined();
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

    expect(result.error).toBeUndefined();
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
    expect(result.error).toContain("patches[1]");
  });

  it("replaceAll works in multi-patch mode", () => {
    const source = "foo bar foo baz foo";
    const result = applyPatches(source, [
      { oldString: "foo", newString: "qux", replaceAll: true },
    ]);
    expect(result.code).toBe("qux bar qux baz qux");
  });
});
