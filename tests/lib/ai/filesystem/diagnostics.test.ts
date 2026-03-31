import { beforeEach, describe, expect, it, vi } from "vitest";

const commandExecutionMocks = vi.hoisted(() => ({
  executeCommandWithValidation: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
}));

vi.mock("@/lib/command-execution", () => ({
  executeCommandWithValidation: commandExecutionMocks.executeCommandWithValidation,
}));

vi.mock("@/lib/settings/settings-manager", () => ({
  loadSettings: settingsMocks.loadSettings,
}));

import { runPostWriteDiagnostics } from "@/lib/ai/filesystem/diagnostics";

describe("runPostWriteDiagnostics", () => {
  const syncedFolder = "/workspace";
  const filePath = "/workspace/src/foo.ts";

  beforeEach(() => {
    vi.clearAllMocks();

    settingsMocks.loadSettings.mockReturnValue({
      postEditHooksPreset: "strict",
      postEditTypecheckEnabled: false,
    });
  });

  it("counts compact formatter warning severity from the location prefix", async () => {
    commandExecutionMocks.executeCommandWithValidation.mockResolvedValueOnce({
      stdout: "src/foo.ts: line 7, col 3, Warning - 'error' is defined but never used.\n",
      stderr: "",
    });

    const result = await runPostWriteDiagnostics(filePath, [syncedFolder], 5000, "write_file");

    expect(result).toMatchObject({
      hasErrors: false,
      errorCount: 0,
      warningCount: 1,
    });
  });

  it("does not misclassify stylish formatter warnings containing the word error", async () => {
    commandExecutionMocks.executeCommandWithValidation.mockResolvedValueOnce({
      stdout: "12:7  warning  'error' is defined but never used\n",
      stderr: "",
    });

    const result = await runPostWriteDiagnostics(filePath, [syncedFolder], 5000, "write_file");

    expect(result).toMatchObject({
      hasErrors: false,
      errorCount: 0,
      warningCount: 1,
    });
  });
});
