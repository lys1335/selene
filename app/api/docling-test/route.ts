import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, extname, join, relative } from "path";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

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

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursive(fullPath);
    }
    return [fullPath];
  }));

  return files.flat();
}

function trimOutput(value: string, maxLength = 20_000): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

export async function POST(req: NextRequest) {
  const cleanupPaths: string[] = [];
  const startedAt = Date.now();

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const extension = extname(file.name) || ".pdf";
    const safeBaseName = basename(file.name, extension).replace(/[^a-zA-Z0-9._-]+/g, "-") || "document";

    const workDir = await mkdtemp(join(tmpdir(), "selene-docling-test-"));
    cleanupPaths.push(workDir);

    const inputPath = join(workDir, `${safeBaseName}${extension}`);
    const outputDir = join(workDir, "out");
    await mkdir(outputDir, { recursive: true });

    await writeFile(inputPath, fileBuffer);

    const command = [
      "uv",
      "tool",
      "run",
      "--from",
      "docling",
      "docling",
      inputPath,
      "--to",
      "md",
      "--output",
      outputDir,
      "--device",
      "cpu",
      "--num-threads",
      "4",
      "--document-timeout",
      "120",
      "--verbose",
    ];

    const result = await new Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
      error?: string;
    }>((resolve) => {
      const child = spawn(command[0], command.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode: null, stdout, stderr, error: error.message });
      });

      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode, stdout, stderr });
      });
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
    await Promise.all(cleanupPaths.map(async (target) => {
      try {
        const info = await stat(target);
        if (info) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors in this temporary test route.
      }
    }));
  }
}
