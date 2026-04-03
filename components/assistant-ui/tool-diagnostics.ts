export interface ToolDiagnosticResult {
  tool: string;
  errors?: number;
  warnings?: number;
  output?: string;
  errorCount?: number;
  warningCount?: number;
  diagnostics?: string;
}

export function normalizeDiagnostics(diagnostic: ToolDiagnosticResult) {
  return {
    tool: diagnostic.tool,
    errors: diagnostic.errors ?? diagnostic.errorCount ?? 0,
    warnings: diagnostic.warnings ?? diagnostic.warningCount ?? 0,
    output: diagnostic.output ?? diagnostic.diagnostics ?? "",
  };
}

export function getDiagnosticCounts(diagnostic: ToolDiagnosticResult) {
  const { errors, warnings } = normalizeDiagnostics(diagnostic);
  return { errors, warnings };
}

export function getDiagnosticOutput(diagnostic: ToolDiagnosticResult) {
  return normalizeDiagnostics(diagnostic).output;
}
