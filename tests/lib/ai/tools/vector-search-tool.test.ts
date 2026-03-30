import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  tool: ({ execute, inputSchema, description }: any) => ({ execute, inputSchema, description }),
  jsonSchema: (schema: any) => schema,
}));

const loggingMocks = vi.hoisted(() => ({
  withToolLogging: vi.fn(
    (_toolName: string, _sessionId: string | undefined, executeFn: (args: any, options?: any) => Promise<any>) =>
      (args: any, options?: any) => executeFn(args, options)
  ),
}));

const vectorDbMocks = vi.hoisted(() => ({
  searchWithRouter: vi.fn(),
  getSyncFolders: vi.fn(),
  getAgentTableStats: vi.fn(),
}));

const vectorClientMocks = vi.hoisted(() => ({
  isVectorDBEnabled: vi.fn(() => true),
}));

const vectorConfigMocks = vi.hoisted(() => ({
  getVectorSearchConfig: vi.fn(() => ({ enableLLMSynthesis: false })),
}));

vi.mock("@/lib/ai/tool-registry/logging", () => ({
  withToolLogging: loggingMocks.withToolLogging,
}));

vi.mock("@/lib/vectordb", () => ({
  searchWithRouter: vectorDbMocks.searchWithRouter,
  getSyncFolders: vectorDbMocks.getSyncFolders,
  getAgentTableStats: vectorDbMocks.getAgentTableStats,
}));

vi.mock("@/lib/vectordb/client", () => ({
  isVectorDBEnabled: vectorClientMocks.isVectorDBEnabled,
}));

vi.mock("@/lib/config/vector-search", () => ({
  getVectorSearchConfig: vectorConfigMocks.getVectorSearchConfig,
}));

vi.mock("@/lib/ai/vector-search/synthesizer", () => ({
  synthesizeSearchResults: vi.fn(),
}));

vi.mock("@/lib/ai/vector-search/file-tree-cache", () => ({
  getFileTreeSummaryForSearch: vi.fn(),
}));

import { createVectorSearchToolV2 } from "@/lib/ai/vector-search/tool";

function createTool() {
  return createVectorSearchToolV2({
    sessionId: "sess-1",
    userId: "user-1",
    characterId: "char-1",
  });
}

describe("vectorSearch tool empty-state messaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vectorClientMocks.isVectorDBEnabled.mockReturnValue(true);
    vectorConfigMocks.getVectorSearchConfig.mockReturnValue({ enableLLMSynthesis: false });
    vectorDbMocks.searchWithRouter.mockResolvedValue([]);
  });

  it("reports missing searchable embeddings for the current agent instead of blaming files-only mode", async () => {
    vectorDbMocks.getSyncFolders.mockResolvedValue([
      {
        id: "folder-1",
        indexingMode: "auto",
        embeddingModel: "qwen/qwen3-embedding-4b",
        chunkCount: 28984,
      },
    ]);
    vectorDbMocks.getAgentTableStats.mockResolvedValue({ exists: false, rowCount: 0 });

    const tool = createTool();
    const result = await tool.execute(
      { query: "Where is auth handled?" },
      { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal }
    ) as any;

    expect(result.status).toBe("no_results");
    expect(result.message).toContain("No searchable embeddings are available for the current agent's synced folders yet.");
    expect(result.message).toContain("another agent shows the same path as indexed");
    expect(result.message).not.toMatch(/files[- ]?only/i);
  });

  it("still points to files-only mode when the current agent folders are actually files-only", async () => {
    vectorDbMocks.getSyncFolders.mockResolvedValue([
      {
        id: "folder-1",
        indexingMode: "files-only",
        embeddingModel: null,
        chunkCount: 0,
      },
    ]);
    vectorDbMocks.getAgentTableStats.mockResolvedValue({ exists: false, rowCount: 0 });

    const tool = createTool();
    const result = await tool.execute(
      { query: "Where is auth handled?" },
      { toolCallId: "tc-2", messages: [], abortSignal: new AbortController().signal }
    ) as any;

    expect(result.status).toBe("no_results");
    expect(result.message).toContain("Some folders are still in files-only mode or have not built embeddings yet.");
    expect(result.message).toContain("switch folders to 'full' mode");
  });
});
