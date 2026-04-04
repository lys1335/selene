/**
 * Docling subprocess runner
 *
 * Low-level utility for executing the `uv tool run --from docling docling`
 * CLI as a child process.  Both the document parser and the docling-test
 * diagnostic route share this primitive.
 */

import { spawn } from "child_process";
import { mkdir, mkdtemp, readdir, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DoclingRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Present when the process failed to spawn (e.g. `uv` not found). */
  error?: string;
}

interface DoclingRunOptions {
  /** Absolute path of the file to convert. */
  inputPath: string;
  /** Directory where docling should write its output files. */
  outputDir: string;
  /**
   * Optional `--from` format hint passed to docling (e.g. `"xml_jats"`).
   * When provided it is inserted before the `inputPath` positional argument.
   */
  doclingInputFormat?: string;
  /** Extra CLI flags appended after the fixed arguments. */
  extraArgs?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively list all files under `dir`, returning absolute paths.
 */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }
      return [fullPath];
    }),
  );
  return files.flat();
}

/**
 * Clean up a list of temporary paths, ignoring any errors.
 */
export async function cleanupTempPaths(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (target) => {
      try {
        const info = await stat(target);
        if (info) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup failures.
      }
    }),
  );
}

/**
 * Create a fresh temporary working directory suitable for a single docling
 * run.  Returns the directory path; callers are responsible for cleanup.
 */
export async function createDoclingWorkDir(prefix = "selene-docling-"): Promise<{
  workDir: string;
  outputDir: string;
}> {
  const workDir = await mkdtemp(join(tmpdir(), prefix));
  const outputDir = join(workDir, "out");
  await mkdir(outputDir, { recursive: true });
  return { workDir, outputDir };
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/**
 * Invoke `uv tool run --from docling docling` and wait for it to finish.
 *
 * The caller is responsible for creating the output directory and for cleaning
 * up temporary paths afterwards.
 */
export async function runDocling(options: DoclingRunOptions): Promise<DoclingRunResult> {
  const { inputPath, outputDir, doclingInputFormat, extraArgs = [] } = options;

  const args: string[] = [
    "tool",
    "run",
    "--from",
    "docling",
    "docling",
  ];

  if (doclingInputFormat) {
    args.push("--from", doclingInputFormat);
  }

  args.push(
    inputPath,
    "--to",
    "md",
    "--output",
    outputDir,
    "--device",
    "cpu",
    "--document-timeout",
    "120",
    ...extraArgs,
  );

  return new Promise<DoclingRunResult>((resolve) => {
    const child = spawn("uv", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, stdout, stderr, error: error.message });
    });

    child.on("close", (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, stdout, stderr });
    });
  });
}
