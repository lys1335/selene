/**
 * Shared project root resolution utility.
 *
 * Resolves the Selene project root directory from the module's own filesystem
 * location, avoiding dependence on `process.cwd()` which can differ in
 * Electron, worker, or test contexts.
 *
 * Used by:
 * - lib/design/libraries.ts (sandbox directory resolution)
 * - lib/design/workspace/compiler.ts (esbuild resolve paths)
 * - lib/ai/tools/design-workspace-tool.ts (npm install cwd)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Resolve the project root directory.
 *
 * Strategy: use `import.meta.url` to locate this file
 * (lib/utils/project-root.ts → go up 2 levels to reach project root).
 * Falls back to `process.cwd()` if `import.meta.url` is unavailable
 * (e.g. in some bundled or CJS contexts).
 */
export function getProjectRoot(): string {
  try {
    if (typeof import.meta?.url === "string") {
      // This file is at lib/utils/project-root.ts → ../../ = project root
      return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    }
  } catch {
    // Fallback for environments where import.meta.url isn't available
  }
  return process.cwd();
}
