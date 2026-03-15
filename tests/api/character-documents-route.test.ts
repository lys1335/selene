import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentProcessingError, DocumentErrorCode } from "@/lib/documents/errors";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => "auth-user-1"),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(() => ({ localUserEmail: "local@example.com" })),
}));

const dbMocks = vi.hoisted(() => ({
  getOrCreateLocalUser: vi.fn(async () => ({ id: "user-1" })),
  getAgentDocumentById: vi.fn(),
  listAgentDocumentsForCharacter: vi.fn(async () => []),
  createAgentDocument: vi.fn(async (payload) => ({ id: "doc-1", ...payload })),
  createAgentDocumentChunks: vi.fn(async () => undefined),
  deleteAgentDocument: vi.fn(async () => undefined),
  deleteAgentDocumentChunksByDocumentId: vi.fn(async () => undefined),
  updateAgentDocument: vi.fn(async () => undefined),
}));

const characterMocks = vi.hoisted(() => ({
  getCharacter: vi.fn(async () => ({ id: "character-1", userId: "user-1" })),
}));

const storageMocks = vi.hoisted(() => ({
  saveDocumentFile: vi.fn(async () => ({
    localPath: "docs/user-1/character-1/sample.docx",
    url: "/api/media/docs/user-1/character-1/sample.docx",
    filePath: "/tmp/sample.docx",
    extension: "docx",
  })),
  deleteLocalFile: vi.fn(),
}));

const parserMocks = vi.hoisted(() => ({
  extractTextFromDocument: vi.fn(),
}));

const chunkingMocks = vi.hoisted(() => ({
  chunkText: vi.fn(() => [{ index: 0, text: "chunk body", tokenCount: 2 }]),
}));

const embeddingMocks = vi.hoisted(() => ({
  indexAgentDocumentEmbeddings: vi.fn(async () => ({ embeddedChunkCount: 1 })),
}));

const vectorConfigMocks = vi.hoisted(() => ({
  getVectorSearchConfig: vi.fn(() => ({ maxChunksPerFile: 20 })),
}));

vi.mock("@/lib/auth/local-auth", () => authMocks);
vi.mock("@/lib/settings/settings-manager", () => settingsMocks);
vi.mock("@/lib/db/queries", () => dbMocks);
vi.mock("@/lib/characters/queries", () => characterMocks);
vi.mock("@/lib/storage/local-storage", () => storageMocks);
vi.mock("@/lib/documents/parser", () => parserMocks);
vi.mock("@/lib/documents/chunking", () => chunkingMocks);
vi.mock("@/lib/documents/embeddings", () => embeddingMocks);
vi.mock("@/lib/config/vector-search", () => vectorConfigMocks);

import { POST } from "@/app/api/characters/[id]/documents/route";

describe("POST /api/characters/[id]/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parserMocks.extractTextFromDocument.mockResolvedValue({
      format: "docx",
      text: "Extracted document body",
      extractionMethod: "docling",
      pageCount: 1,
    });
    dbMocks.getAgentDocumentById.mockResolvedValue({
      id: "doc-1",
      status: "ready",
    });
  });

  it("returns typed parser errors as 400 and cleans up stored files", async () => {
    parserMocks.extractTextFromDocument.mockRejectedValueOnce(
      new DocumentProcessingError(
        DocumentErrorCode.UNSUPPORTED_DOCUMENT_FORMAT,
        "Legacy Excel .xls is not supported yet.",
        "legacy.xls",
        "Save the workbook as .xlsx and try again.",
      ),
    );

    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "legacy.xls", { type: "application/vnd.ms-excel" }),
    );

    const response = await POST(
      new Request("http://localhost/api/characters/character-1/documents", {
        method: "POST",
        body: formData,
      }) as any,
      { params: Promise.resolve({ id: "character-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Legacy Excel .xls is not supported yet.",
      errorCode: DocumentErrorCode.UNSUPPORTED_DOCUMENT_FORMAT,
      suggestedAction: "Save the workbook as .xlsx and try again.",
    });
    expect(storageMocks.deleteLocalFile).toHaveBeenCalledWith("docs/user-1/character-1/sample.docx");
    expect(dbMocks.createAgentDocument).not.toHaveBeenCalled();
  });

  it("creates and indexes supported document uploads", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File([new TextEncoder().encode("hello")], "sample.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    formData.append("title", "Sample title");

    const response = await POST(
      new Request("http://localhost/api/characters/character-1/documents", {
        method: "POST",
        body: formData,
      }) as any,
      { params: Promise.resolve({ id: "character-1" }) },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.chunkCount).toBe(1);
    expect(body.embeddedChunkCount).toBe(1);
    expect(parserMocks.extractTextFromDocument).toHaveBeenCalledWith(
      expect.any(Buffer),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "sample.docx",
    );
    expect(dbMocks.createAgentDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: "sample.docx",
        title: "Sample title",
      }),
    );
    expect(dbMocks.createAgentDocumentChunks).toHaveBeenCalledTimes(1);
    expect(embeddingMocks.indexAgentDocumentEmbeddings).toHaveBeenCalledWith({
      documentId: "doc-1",
      userId: "user-1",
    });
  });
});
