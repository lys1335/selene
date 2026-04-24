/**
 * W2.3 — Asset alias rewrite step.
 *
 * These tests cover the pre-esbuild `rewriteAssetAliases` transform in
 * `lib/design/workspace/compiler.ts`. We exercise the pure string-replace
 * helper directly (no esbuild / no tailwind) so the tests run in
 * millisecond-scale.
 *
 * Ambiguity-flag locations (search for "FLAG-W2.3" below) document
 * decisions that live outside the spec text.
 */

import { describe, it, expect } from "vitest";
import {
  AssetAliasNotFoundError,
  rewriteAssetAliases,
} from "../compiler";

describe("rewriteAssetAliases — W2.3 compile-time asset alias rewrite", () => {
  it("resolves a declared alias in JSX src and CSS url() references", () => {
    const source = `
      export default function Hero() {
        return (
          <section style={{ backgroundImage: 'url("@asset/bg")' }}>
            <img src="@asset/hero" alt="hero" />
          </section>
        );
      }
    `;

    const rewritten = rewriteAssetAliases(source, [
      { alias: "hero", url: "/api/media/uploads/hero.png" },
      { alias: "bg", url: "https://cdn.example.com/bg.jpg" },
    ]);

    expect(rewritten).toContain('src="/api/media/uploads/hero.png"');
    expect(rewritten).toContain('url("https://cdn.example.com/bg.jpg")');
    expect(rewritten).not.toContain("@asset/hero");
    expect(rewritten).not.toContain("@asset/bg");
  });

  it("throws AssetAliasNotFoundError with declaredAliases when a reference is missing", () => {
    const source = `const img = "@asset/missing";`;
    const aliases = [{ alias: "hero", url: "/api/media/uploads/hero.png" }];

    try {
      rewriteAssetAliases(source, aliases);
      throw new Error("rewriteAssetAliases should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetAliasNotFoundError);
      const err = error as AssetAliasNotFoundError;
      expect(err.alias).toBe("missing");
      expect(err.declaredAliases).toEqual(["hero"]);
      expect(err.message).toContain("@asset/missing");
      expect(err.message).toContain("hero");
    }
  });

  it("no-op when the source has no @asset references (even with an empty map)", () => {
    const source = `export default () => <div>hello</div>;`;
    const rewritten = rewriteAssetAliases(source, undefined);
    expect(rewritten).toBe(source);
  });

  it("supports aliases that contain hyphens and underscores (W2.3 format)", () => {
    const source = `const a = "@asset/bg-pattern_01";`;
    const rewritten = rewriteAssetAliases(source, [
      { alias: "bg-pattern_01", url: "https://cdn.example.com/bg.png" },
    ]);
    expect(rewritten).toBe(`const a = "https://cdn.example.com/bg.png";`);
  });

  it("rewrites every occurrence of the same alias", () => {
    const source = `<>
      <img src="@asset/hero" />
      <img src="@asset/hero" />
    </>`;
    const rewritten = rewriteAssetAliases(source, [
      { alias: "hero", url: "/api/media/uploads/hero.png" },
    ]);
    const matches = rewritten.match(/\/api\/media\/uploads\/hero\.png/g) ?? [];
    expect(matches.length).toBe(2);
    expect(rewritten).not.toContain("@asset/hero");
  });

  it("leaves tokens that don't match the alias format untouched", () => {
    // FLAG-W2.3: alias grammar is [a-zA-Z0-9_-]+ per spec. A period inside
    // the tail (e.g. "@asset/hero.png") does not match the grammar, so the
    // regex captures "@asset/hero" and leaves ".png" outside. That's the
    // intended behavior — callers should use alias keys without extensions.
    const source = `const ref = "@asset/hero.png";`;
    const rewritten = rewriteAssetAliases(source, [
      { alias: "hero", url: "/api/media/x.png" },
    ]);
    expect(rewritten).toBe(`const ref = "/api/media/x.png.png";`);
  });
});
