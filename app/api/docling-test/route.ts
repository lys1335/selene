import { readFile, writeFile } from "fs/promises";
import { basename, extname, join, relative } from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  runDocling,
  listFilesRecursive,
  cleanupTempPaths,
  createDoclingWorkDir,
} from "@/lib/documents/docling-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DoclingTestSuccess = {
  ok: true;
  command: string[];
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputFiles: string[];
  markdown?: string;
  markdownPath?: string;
};

type DoclingTestFailure = {
  ok: false;
  command: string[];
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error: string;
  outputFiles?: string[];
};

function trimOutput(value: string, maxLength = 20_000): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

// Extra diagnostic flags passed only by the test endpoint, not in production.
const DOCLING_TEST_EXTRA_ARGS = ["--num-threads", "4", "--verbose"];

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let workDir: string | undefined;

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const extension = extname(file.name) || ".pdf";
    const safeBaseName = basename(file.name, extension).replace(/[^a-zA-Z0-9._-]+/g, "-") || "document";

    const dirs = await createDoclingWorkDir("selene-docling-test-");
    workDir = dirs.workDir;
    const { outputDir } = dirs;

    const inputPath = join(workDir, `${safeBaseName}${extension}`);
    await writeFile(inputPath, fileBuffer);

    // Build the full command array for inclusion in the diagnostic response.
    const command = [
      "uv", "tool", "run", "--from", "docling", "docling",
      inputPath,
      "--to", "md",
      "--output", outputDir,
      "--device", "cpu",
      "--document-timeout", "120",
      ...DOCLING_TEST_EXTRA_ARGS,
    ];

    const result = await runDocling({
      inputPath,
      outputDir,
      extraArgs: DOCLING_TEST_EXTRA_ARGS,
    });

    const durationMs = Date.now() - startedAt;
    const absoluteOutputFiles = await listFilesRecursive(outputDir);
    const outputFiles = absoluteOutputFiles.map((filePath) => relative(outputDir, filePath));
    const markdownRelativePath = outputFiles.find((filePath) => filePath.endsWith(".md"));
    const markdownFile = markdownRelativePath ? join(outputDir, markdownRelativePath) : undefined;
    const markdown = markdownFile ? await readFile(markdownFile, "utf8") : undefined;

    if (result.error || result.exitCode !== 0) {
      const payload: DoclingTestFailure = {
        ok: false,
        command,
        exitCode: result.exitCode,
        durationMs,
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
        error: result.error ?? "Docling exited with a non-zero status",
        outputFiles,
      };

      return NextResponse.json(payload, { status: 500 });
    }

    const payload: DoclingTestSuccess = {
      ok: true,
      command,
      exitCode: result.exitCode,
      durationMs,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
      outputFiles,
      markdown: markdown ? trimOutput(markdown, 30_000) : undefined,
      markdownPath: markdownRelativePath,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const payload: DoclingTestFailure = {
      ok: false,
      command: [],
      exitCode: null,
      durationMs,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };

    return NextResponse.json(payload, { status: 500 });
  } finally {
    if (workDir) {
      await cleanupTempPaths([workDir]);
    }
  }
}
