import { beforeEach, describe, expect, it, vi } from "vitest";

const syncFolderMocks = vi.hoisted(() => ({
  getAccessibleSyncFolders: vi.fn(),
}));

const filesystemMocks = vi.hoisted(() => ({
  getActiveWorktreePath: vi.fn(),
  isOtherWorktreePath: vi.fn(),
}));

const commandExecutionMocks = vi.hoisted(() => ({
  executeCommandWithValidation: vi.fn(),
  startBackgroundProcess: vi.fn(),
  getBackgroundProcess: vi.fn(),
  killBackgroundProcess: vi.fn(),
  listBackgroundProcesses: vi.fn(),
  cleanupBackgroundProcesses: vi.fn(),
}));

const cwdStateMocks = vi.hoisted(() => ({
  getPersistedCommandCwd: vi.fn(),
  setPersistedCommandCwd: vi.fn(),
}));

const delegationWaitingMocks = vi.hoisted(() => ({
  registerBackgroundTask: vi.fn(),
}));

vi.mock("@/lib/vectordb/accessible-sync-folders", () => ({
  getAccessibleSyncFolders: syncFolderMocks.getAccessibleSyncFolders,
}));

vi.mock("@/lib/ai/filesystem", () => ({
  getActiveWorktreePath: filesystemMocks.getActiveWorktreePath,
  isOtherWorktreePath: filesystemMocks.isOtherWorktreePath,
}));

vi.mock("@/lib/command-execution", () => ({
  executeCommandWithValidation: commandExecutionMocks.executeCommandWithValidation,
  startBackgroundProcess: commandExecutionMocks.startBackgroundProcess,
  getBackgroundProcess: commandExecutionMocks.getBackgroundProcess,
  killBackgroundProcess: commandExecutionMocks.killBackgroundProcess,
  listBackgroundProcesses: commandExecutionMocks.listBackgroundProcesses,
  cleanupBackgroundProcesses: commandExecutionMocks.cleanupBackgroundProcesses,
}));

vi.mock("@/lib/command-execution/cwd-state", () => ({
  getPersistedCommandCwd: cwdStateMocks.getPersistedCommandCwd,
  setPersistedCommandCwd: cwdStateMocks.setPersistedCommandCwd,
}));

vi.mock("@/app/api/chat/delegation-waiting", () => ({
  registerBackgroundTask: delegationWaitingMocks.registerBackgroundTask,
}));

import { createBashTool } from "@/lib/ai/tools/bash-tool";

function createToolContext() {
  return {
    toolCallId: "tc-1",
    messages: [],
    abortSignal: new AbortController().signal,
  };
}

describe("bash-tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    syncFolderMocks.getAccessibleSyncFolders.mockResolvedValue([
      { folderPath: "/workspace" },
    ]);
    filesystemMocks.getActiveWorktreePath.mockResolvedValue(null);
    filesystemMocks.isOtherWorktreePath.mockReturnValue(false);
    cwdStateMocks.getPersistedCommandCwd.mockResolvedValue(null);
    cwdStateMocks.setPersistedCommandCwd.mockResolvedValue(undefined);

    commandExecutionMocks.executeCommandWithValidation.mockResolvedValue({
      success: true,
      stdout: "status ok\n__SELENE_CWD__:/workspace/app",
      stderr: "",
      exitCode: 0,
      signal: null,
      executionTime: 25,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("wraps a shell command and persists cwd markers", async () => {
    const tool = createBashTool({
      sessionId: "sess-1",
      characterId: "char-1",
    });

    const result = await tool.execute(
      { command: "git status" },
      createToolContext()
    );

    expect(result.status).toBe("success");
    expect(result.stdout).toBe("status ok");
    expect(cwdStateMocks.setPersistedCommandCwd).toHaveBeenCalledWith(
      "sess-1",
      "/workspace/app"
    );

    expect(commandExecutionMocks.executeCommandWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/bin/sh",
        cwd: "/workspace",
        characterId: "char-1",
        args: [
          "-lc",
          expect.stringContaining("git status"),
        ],
      }),
      ["/workspace"]
    );
  });

  it("reuses persisted cwd when available", async () => {
    cwdStateMocks.getPersistedCommandCwd.mockResolvedValue("/workspace/app");

    const tool = createBashTool({
      sessionId: "sess-1",
      characterId: "char-1",
    });

    await tool.execute(
      { command: "npm test" },
      createToolContext()
    );

    expect(commandExecutionMocks.executeCommandWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/workspace/app" }),
      ["/workspace"]
    );
  });

  it("blocks dangerous shell removal commands", async () => {
    const tool = createBashTool({
      sessionId: "sess-1",
      characterId: "char-1",
    });

    const result = await tool.execute(
      { command: "rm -rf node_modules" },
      createToolContext()
    );

    expect(result.status).toBe("blocked");
    expect(result.error).toContain("removal command");
    expect(commandExecutionMocks.executeCommandWithValidation).not.toHaveBeenCalled();
  });

  it("starts background shell commands", async () => {
    commandExecutionMocks.startBackgroundProcess.mockResolvedValue({
      processId: "bg-123",
    });

    const tool = createBashTool({
      sessionId: "sess-1",
      characterId: "char-1",
    });

    const result = await tool.execute(
      { command: "npm run dev", run_in_background: true },
      createToolContext()
    );

    expect(result.status).toBe("background_started");
    expect(result.processId).toBe("bg-123");
    expect(commandExecutionMocks.startBackgroundProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/bin/sh",
        cwd: "/workspace",
        args: ["-lc", expect.stringContaining("npm run dev")],
      }),
      ["/workspace"]
    );
  });
});
