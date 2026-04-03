/**
 * Low-level git command runner shared between the workspace API route and
 * the workspace agent tool.  Uses execFile for normal operation and falls
 * back to spawnWithFileCapture when execFile hits EBADF on macOS (a known
 * FSEvents / file-descriptor issue).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { isEBADFError, spawnWithFileCapture } from "@/lib/spawn-utils";

const execFileAsync = promisify(execFile);

export const GIT_TIMEOUT_MS = 30_000;
export const GIT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function gitExecOptions(cwd: string) {
  return {
    cwd,
    encoding: "utf-8" as const,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_OUTPUT_BYTES,
  };
}

export async function runGitCommand(
  cwd: string,
  args: string[],
  input?: string,
  logTag = "[workspace]"
): Promise<string> {
  if (typeof input === "string") {
    const fb = await spawnWithFileCapture(
      "git",
      args,
      cwd,
      process.env as NodeJS.ProcessEnv,
      GIT_TIMEOUT_MS,
      GIT_MAX_OUTPUT_BYTES,
      input,
    );
    const exitCode = fb.exitCode ?? 1;
    if (fb.timedOut) {
      throw new Error(`Git command timed out after ${GIT_TIMEOUT_MS}ms`);
    }
    if (exitCode !== 0) {
      const detail = fb.stderr.trim() || fb.stdout.trim() || `exit code ${exitCode}`;
      throw new Error(`Git command failed: ${detail}`);
    }
    return fb.stdout;
  }

  try {
    const { stdout } = await execFileAsync("git", args, gitExecOptions(cwd));
    return stdout;
  } catch (error) {
    if (isEBADFError(error) && process.platform === "darwin") {
      console.warn(`${logTag} git execFile EBADF - retrying with file-capture fallback`);
      const fb = await spawnWithFileCapture(
        "git",
        args,
        cwd,
        process.env as NodeJS.ProcessEnv,
        GIT_TIMEOUT_MS,
        GIT_MAX_OUTPUT_BYTES,
      );
      const exitCode = fb.exitCode ?? 1;
      if (fb.timedOut) {
        throw new Error(`Git command timed out after ${GIT_TIMEOUT_MS}ms`);
      }
      if (exitCode !== 0) {
        const detail = fb.stderr.trim() || fb.stdout.trim() || `exit code ${exitCode}`;
        throw new Error(`Git command failed: ${detail}`);
      }
      return fb.stdout;
    }
    throw error;
  }
}
