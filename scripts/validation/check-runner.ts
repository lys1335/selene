/**
 * Shared file-content checking and reporting utility for validation scripts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Check {
  id: string;
  description: string;
  filePath: string;
  requiredSnippets: string[];
}

export function readUtf8(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

/**
 * Run all checks and print PASS/FAIL lines to the console.
 * Returns the number of failed checks.
 * When `tolerateMissing` is true, a file that cannot be read is reported
 * as a failure but does not throw.
 */
export function runChecks(checks: Check[], tolerateMissing = false): number {
  let failed = 0;

  for (const check of checks) {
    let fileContent: string;
    try {
      fileContent = readUtf8(check.filePath);
    } catch (error) {
      if (!tolerateMissing) throw error;
      failed += 1;
      console.error(`FAIL ${check.id}`);
      console.error(`  ${check.description}`);
      console.error(`  File: ${check.filePath}`);
      console.error(`  Read error: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const missing = check.requiredSnippets.filter((snippet) => !fileContent.includes(snippet));

    if (missing.length === 0) {
      console.log(`PASS ${check.id}`);
      console.log(`  ${check.description}`);
      continue;
    }

    failed += 1;
    console.error(`FAIL ${check.id}`);
    console.error(`  ${check.description}`);
    console.error(`  File: ${check.filePath}`);
    for (const snippet of missing) {
      console.error(`  Missing snippet: ${snippet}`);
    }
  }

  return failed;
}
