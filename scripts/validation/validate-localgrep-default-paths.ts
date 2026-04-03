#!/usr/bin/env tsx
/**
 * Validate localGrep default path handling and workspace fallback contracts.
 *
 * Usage:
 *   npx tsx scripts/validation/validate-localgrep-default-paths.ts --dry-run
 */

import { type Check, runChecks } from "./check-runner";

const checks: Check[] = [
  {
    id: "workspace-default-resolution",
    description: "localGrep resolves workspace path from session metadata before synced folders",
    filePath: "lib/ai/ripgrep/tool.ts",
    requiredSnippets: [
      "const workspacePath = await resolveWorkspaceSearchPath(sessionId);",
      "pathSource = \"workspace\";",
      "attemptedScopes.push(\"workspace\");",
    ],
  },
  {
    id: "same-call-fallback",
    description: "localGrep retries with synced folders in the same call when workspace returns zero matches",
    filePath: "lib/ai/ripgrep/tool.ts",
    requiredSnippets: [
      "if (!hasExplicitPaths && pathSource === \"workspace\" && searchResult.matches.length === 0)",
      "finalPathSource = \"workspace_then_synced\";",
      "fallbackUsed = true;",
    ],
  },
  {
    id: "structured-path-diagnostics",
    description: "localGrep response exposes path diagnostics for auditing",
    filePath: "lib/ai/ripgrep/tool.ts",
    requiredSnippets: [
      "pathSource: finalPathSource,",
      "attemptedScopes: attemptedScopes.length > 0 ? attemptedScopes : undefined,",
      "fallbackUsed,",
    ],
  },
  {
    id: "ui-success-message-visibility",
    description: "localGrep success message is rendered in tool fallback UI",
    filePath: "components/assistant-ui/tool-fallback.tsx",
    requiredSnippets: [
      "{grepResult.message && (",
      "text-terminal-muted",
    ],
  },
  {
    id: "tests-cover-workspace-defaults",
    description: "localGrep tests cover workspace-first and fallback-to-synced behavior",
    filePath: "tests/lib/ai/tools/local-grep-tool.test.ts",
    requiredSnippets: [
      "prefers workspace path when no explicit paths are provided",
      "retries with synced folders in same call when workspace search has zero matches",
      "pathSource: \"workspace_then_synced\"",
    ],
  },
];

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== localGrep Default Path Validation ===");
  console.log(`Mode: ${dryRun ? "dry-run" : "validate"}`);
  console.log("This validation script is read-only and does not modify files.\n");

  const failed = runChecks(checks);

  console.log("\n=== Validation Summary ===");
  if (failed > 0) {
    const summary = `Failed checks: ${failed}/${checks.length}`;
    if (dryRun) {
      console.warn(`${summary} (dry-run: non-fatal)`);
      return;
    }
    console.error(summary);
    process.exit(1);
  }

  console.log(`All checks passed: ${checks.length}/${checks.length}`);
}

main();
