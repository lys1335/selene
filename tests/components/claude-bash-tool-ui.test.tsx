import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClaudeBashToolUI } from "@/components/assistant-ui/claude-code-tools";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === "exitCode" && values?.code !== undefined) return `Exit code ${values.code}`;
    if (key === "output") return "Output";
    if (key === "standardError") return "Standard Error";
    if (key === "stdErrWarning") return " (warning)";
    if (key === "expandOutput") return "Expand output";
    if (key === "collapseOutput") return "Collapse output";
    if (key === "truncated") return `Truncated (${values?.logId ?? ""})`;
    return key;
  },
}));

describe("ClaudeBashToolUI", () => {
  it("renders structured bash errors with stderr details", () => {
    render(
      <ClaudeBashToolUI
        toolName="Bash"
        args={{ command: "python -V" }}
        result={{
          status: "error",
          error: "Command execution failed",
          stderr: "python: command not found",
          exitCode: 127,
          executionTime: 12,
        }}
      />
    );

    expect(screen.getByText("Command execution failed")).toBeInTheDocument();
    expect(screen.getByText("python: command not found")).toBeInTheDocument();
    expect(screen.getByText("Exit code 127")).toBeInTheDocument();
  });

  it("renders background status calls with a derived process label", () => {
    render(
      <ClaudeBashToolUI
        toolName="Bash"
        args={{ processId: "bg-123", action: "status" }}
        result={{
          status: "running",
          stdout: "installing...",
        }}
      />
    );

    expect(screen.getByText("check process bg-123")).toBeInTheDocument();
    expect(screen.getByText("installing...")).toBeInTheDocument();
  });

  it("normalizes apply_patch heredoc labels for inline diff rendering", () => {
    render(
      <ClaudeBashToolUI
        toolName="Bash"
        args={{
          command: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: foo.ts\n+hi\n*** End Patch\nPATCH",
        }}
        result={{
          status: "error",
          inlineDiff: "*** Begin Patch\n*** Add File: foo.ts\n+hi\n*** End Patch\n",
          error: "patch failed",
        }}
      />
    );

    expect(screen.getByText("apply_patch")).toBeInTheDocument();
    expect(screen.getByText("patch failed")).toBeInTheDocument();
  });
});
