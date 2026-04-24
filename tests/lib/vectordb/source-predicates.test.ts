import { describe, expect, it, vi } from "vitest";

// Partial-mock drizzle-orm: keep all original exports (schema files need
// `sql`, `relations`, etc.) but override `eq` and `ne` so we can observe the
// exact operator + column + value each predicate produces. This gives a
// durable assertion that the centralized helpers generate the same SQL shape
// the hand-rolled inline `ne(...)`/`eq(...)` calls used to generate — so
// migrating callsites is a pure refactor.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: any, value: any) => ({ kind: "eq", column, value }) as any,
    ne: (column: any, value: any) => ({ kind: "ne", column, value }) as any,
  };
});

import { agentSyncFolders } from "@/lib/db/sqlite-character-schema";
import {
  excludeWorkspaceSource,
  onlyUserSource,
  onlyWorkspaceSource,
} from "@/lib/vectordb/source-predicates";

describe("source-predicates", () => {
  it("excludeWorkspaceSource returns ne(source, 'workspace')", () => {
    const predicate = excludeWorkspaceSource() as any;
    expect(predicate.kind).toBe("ne");
    expect(predicate.column).toBe(agentSyncFolders.source);
    expect(predicate.value).toBe("workspace");
  });

  it("onlyUserSource returns eq(source, 'user')", () => {
    const predicate = onlyUserSource() as any;
    expect(predicate.kind).toBe("eq");
    expect(predicate.column).toBe(agentSyncFolders.source);
    expect(predicate.value).toBe("user");
  });

  it("onlyWorkspaceSource returns eq(source, 'workspace')", () => {
    const predicate = onlyWorkspaceSource() as any;
    expect(predicate.kind).toBe("eq");
    expect(predicate.column).toBe(agentSyncFolders.source);
    expect(predicate.value).toBe("workspace");
  });

  it("excludeWorkspaceSource and onlyWorkspaceSource target the same column", () => {
    const excl = excludeWorkspaceSource() as any;
    const only = onlyWorkspaceSource() as any;
    // The helpers pair as negations over the same column — a regression here
    // would indicate one helper drifted from the discriminator contract.
    expect(excl.column).toBe(only.column);
    expect(excl.value).toBe(only.value);
    expect(excl.kind).not.toBe(only.kind);
  });
});
