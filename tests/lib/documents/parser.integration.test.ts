import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractTextFromDocument } from "@/lib/documents/parser";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/settings/settings-manager";

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "documents");

function readFixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURE_DIR, name));
}

describe.sequential("extractTextFromDocument fixture coverage", () => {
  let originalSettings: AppSettings | null = null;
  const originalPath = process.env.PATH;

  beforeAll(() => {
    originalSettings = JSON.parse(JSON.stringify(loadSettings())) as AppSettings;
    process.env.PATH = `/opt/homebrew/bin:${originalPath ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    if (originalSettings) {
      saveSettings(originalSettings);
    }
  });

  it("extracts DOCX content into normalized text", async () => {
    const result = await extractTextFromDocument(
      readFixture("sample.docx"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "sample.docx",
    );

    expect(result.format).toBe("docx");
    expect(result.extractionMethod).toBe("docling");
    expect(result.text).toContain("Demonstration of DOCX support in calibre");
    expect(result.text.length).toBeGreaterThan(400);
  }, 90_000);

  it("extracts PPTX slide text", async () => {
    const result = await extractTextFromDocument(
      readFixture("sample.pptx"),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "sample.pptx",
    );

    expect(result.format).toBe("pptx");
    expect(result.extractionMethod).toBe("docling");
    expect(result.text).toContain("Sample Slide containing SmartArt in extLst");
    expect(result.text).toContain("dummy content");
  }, 90_000);

  it("extracts XLSX sheet content", async () => {
    const result = await extractTextFromDocument(
      readFixture("sample.xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "sample.xlsx",
    );

    expect(result.format).toBe("xlsx");
    expect(result.extractionMethod).toBe("docling");
    expect(result.text).toContain("January");
    expect(result.text).toContain("Select Month");
  }, 90_000);

  it("extracts VTT subtitle text", async () => {
    const result = await extractTextFromDocument(
      readFixture("sample.vtt"),
      "text/vtt",
      "sample.vtt",
    );

    expect(result.format).toBe("vtt");
    expect(result.extractionMethod).toBe("docling");
    expect(result.text).toContain("Hello from the Selene VTT fixture.");
    expect(result.text).toContain("It validates subtitle extraction.");
  }, 90_000);

  it("extracts JATS XML content", async () => {
    const result = await extractTextFromDocument(
      readFixture("sample.jats.xml"),
      "application/xml+jats",
      "sample.jats.xml",
    );

    expect(result.format).toBe("xml_jats");
    expect(result.extractionMethod).toBe("docling");
    expect(result.text).toContain("Evolving general practice consultation in Britain");
    expect(result.text).toContain("Summary points");
  }, 90_000);

  it("routes WAV audio through local STT", async () => {
    const current = loadSettings();
    saveSettings({
      ...current,
      sttEnabled: true,
      sttProvider: "local",
      sttLocalModel: "ggml-small.en",
    });

    const result = await extractTextFromDocument(
      readFixture("sample.wav"),
      "audio/wav",
      "sample.wav",
      "chat-attachment",
    );

    expect(result.format).toBe("audio");
    expect(result.extractionMethod).toBe("audio-stt");
    expect(result.metadata).toMatchObject({ provider: "whisper.cpp" });
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });
});
