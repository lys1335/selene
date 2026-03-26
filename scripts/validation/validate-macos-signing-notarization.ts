#!/usr/bin/env tsx
/**
 * Validate macOS builds have signing and notarization disabled.
 *
 * Usage:
 *   npx tsx scripts/validation/validate-macos-signing-notarization.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";

interface GuardCheck {
  id: string;
  description: string;
  filePath: string;
  requiredSnippets: string[];
  forbiddenSnippets?: string[];
}

const checks: GuardCheck[] = [
  {
    id: "electron-builder-signing-disabled",
    description: "electron-builder has macOS signing and notarization disabled",
    filePath: "electron-builder.yml",
    requiredSnippets: [
      "mac:",
      "identity: null",
      "hardenedRuntime: false",
    ],
    forbiddenSnippets: [
      'afterSign: "scripts/notarize.js"',
      'entitlements: "build-resources/entitlements.mac.plist"',
      'entitlementsInherit: "build-resources/entitlements.mac.inherit.plist"',
      "hardenedRuntime: true",
    ],
  },
];

function readUtf8(filePath: string): string {
  const absolutePath = path.join(process.cwd(), filePath);
  return fs.readFileSync(absolutePath, "utf-8");
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== macOS Signing + Notarization Disabled Validation ===");
  console.log(`Mode: ${dryRun ? "dry-run" : "validate"}`);
  console.log("This script is read-only and performs no file writes.\n");

  let failed = 0;

  for (const check of checks) {
    const content = readUtf8(check.filePath);
    const missing = check.requiredSnippets.filter((snippet) => !content.includes(snippet));

    const forbidden = (check.forbiddenSnippets ?? []).filter((snippet) => content.includes(snippet));

    if (missing.length === 0 && forbidden.length === 0) {
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
    for (const snippet of forbidden) {
      console.error(`  Forbidden snippet present: ${snippet}`);
    }
  }

  console.log("\n=== Validation Summary ===");
  if (failed > 0) {
    console.error(`Failed checks: ${failed}/${checks.length}`);
    process.exit(1);
  }

  console.log(`All checks passed: ${checks.length}/${checks.length}`);
  process.exit(0);
}

main();
