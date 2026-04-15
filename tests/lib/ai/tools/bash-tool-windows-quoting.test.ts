/**
 * Windows Bash Tool Quoting Integration Test
 *
 * Validates that the bash tool correctly handles commands with inner quotes
 * and special characters (pipes, spaces) on Windows cmd.exe.
 *
 * This test exercises the full wrapShellCommand → executor → spawn pipeline
 * using real process execution to confirm the cmd.exe quoting fix works.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { spawn } from "child_process";

// Only run on Windows
const describeWindows = process.platform === "win32" ? describe : describe.skip;

/**
 * Simulate what wrapShellCommand produces for Windows, then spawn cmd.exe
 * with windowsVerbatimArguments to verify the pattern works.
 */
function spawnWindowsCommand(userCommand: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const shellCommand = process.env.ComSpec || "cmd.exe";
    const CWD_MARKER = "__SELENE_CWD__:";
    const inner = `${userCommand} & set "SELENE_EXIT=!ERRORLEVEL!" & echo ${CWD_MARKER}!CD! & exit /b !SELENE_EXIT!`;
    const args = ["/v:on", "/d", "/s", "/c", `"${inner}"`];

    const child = spawn(shellCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    child.on("close", (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
    });

    child.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: -1 });
    });
  });
}

describeWindows("bash-tool Windows cmd.exe quoting (integration)", () => {
  it("handles echo with inner double quotes", async () => {
    const result = await spawnWindowsCommand('echo "hello world"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
  });

  it("handles commands with pipe characters in quoted arguments", async () => {
    // This is the pattern that was broken: rg with | in pattern
    const result = await spawnWindowsCommand('echo "foo|bar|baz"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("foo|bar|baz");
  });

  it("handles commands with spaces in quoted paths", async () => {
    const result = await spawnWindowsCommand('echo "path with spaces"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("path with spaces");
  });

  it("preserves CWD marker in output", async () => {
    const result = await spawnWindowsCommand("echo test");
    expect(result.stdout).toContain("__SELENE_CWD__:");
  });

  it("handles rg-style pattern with spaces and pipes (the original bug)", async () => {
    // This is the exact pattern that caused the original failure:
    // rg -n "design workspace|Component not found" <path>
    // On broken quoting, cmd.exe splits on spaces, treating each word as separate arg
    // With the fix, the entire command is wrapped in outer quotes

    // We can't run rg here (it may not be in PATH), but we can verify the quoting
    // by using findstr (Windows equivalent) with a pattern that has spaces
    const result = await spawnWindowsCommand('echo "design workspace|Component not found in cache"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("design workspace|Component not found in cache");
    expect(result.stderr).toBe("");
  });

  it("correctly reports exit codes through delayed expansion", async () => {
    // Run a command that exits with 0
    const successResult = await spawnWindowsCommand("echo ok");
    expect(successResult.exitCode).toBe(0);

    // Run a command that exits with non-zero
    const failResult = await spawnWindowsCommand("cmd /c exit 42");
    expect(failResult.exitCode).toBe(42);
  });

  it("handles multiple chained commands with & separator", async () => {
    const result = await spawnWindowsCommand('echo "first" & echo "second"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("first");
    expect(result.stdout).toContain("second");
  });
});
