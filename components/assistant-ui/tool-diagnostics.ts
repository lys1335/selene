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

interface ParsedLintOutput {
  sortedOutput: string;
  errorLines: string[];
  warningLines: string[];
  otherLines: string[];
}

/**
 * Parse a lint output string, separating error lines from warning lines.
 * Returns them sorted errors-first, then warnings, then other lines.
 */
export function parseLintOutput(output: string): ParsedLintOutput {
  const outputLines = output.split('\n');
  const errorLines: string[] = [];
  const warningLines: string[] = [];
  const otherLines: string[] = [];

  outputLines.forEach(line => {
    if (line.includes('error') || line.includes('✖')) {
      errorLines.push(line);
    } else if (line.includes('warning') || line.includes('⚠')) {
      warningLines.push(line);
    } else {
      otherLines.push(line);
    }
  });

  // Reconstruct output with errors first, then warnings
  const sortedOutput = [
    ...errorLines,
    ...warningLines,
    ...otherLines,
  ].join('\n');

  return { sortedOutput, errorLines, warningLines, otherLines };
}
