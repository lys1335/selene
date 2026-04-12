import { execFile, type ExecFileOptions } from "child_process";
import fs from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import {
  DESIGN_LIBRARIES,
  SANDBOX_DIR,
  SANDBOX_NODE_MODULES,
  SANDBOX_PACKAGE_JSON,
  detectAvailableLibraries,
  ensureSandboxDir,
  registerRuntimeLibrary,
  validatePackageSpec,
} from "../libraries";
import { getProjectRoot } from "../../utils/project-root";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = getProjectRoot();
const IS_WINDOWS = process.platform === "win32";

export interface DependencyValidationResult {
  manifestPackages: string[];
  importedPackages: string[];
  checkedPackages: string[];
  missingManifestPackages: string[];
  missingImportedPackages: string[];
  missingPackages: string[];
}

export interface DependencyInstallResult {
  attempted: boolean;
  success: boolean;
  packages: string[];
  packageNames: string[];
  error?: string;
}

let installLock: Promise<void> | null = null;

/**
 * Resolve the npm command and exec options for the current platform.
 *
 * On Windows, `npm.cmd` is a batch script that requires a shell to execute.
 * Using `execFile` without `shell: true` causes "spawn EINVAL" errors.
 * We use `shell: true` on Windows so `npm.cmd` runs through cmd.exe, which
 * matches the resolution strategy used by the main executor-runtime for
 * environments where a bundled Node/npm-cli.js is unavailable.
 */
function getNpmExecConfig(): { command: string; options: ExecFileOptions } {
  return {
    command: IS_WINDOWS ? "npm.cmd" : "npm",
    options: IS_WINDOWS ? { shell: true } : {},
  };
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))];
}

function normalizePackageName(specifier: string): string | null {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    specifier.startsWith("data:")
  ) {
    return null;
  }

  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }

  return specifier.split("/")[0] || null;
}

function collectPackageMatches(code: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of code.matchAll(pattern)) {
    const packageName = normalizePackageName(match[1] ?? "");
    if (packageName) {
      matches.push(packageName);
    }
  }
  return matches;
}

export function extractImportedPackages(componentCode: string): string[] {
  return uniqueStrings([
    ...collectPackageMatches(
      componentCode,
      /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    ),
    ...collectPackageMatches(componentCode, /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g),
    ...collectPackageMatches(componentCode, /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g),
  ]);
}

async function readSandboxManifestPackages(): Promise<string[]> {
  await ensureSandboxDir();

  try {
    const raw = await fs.readFile(SANDBOX_PACKAGE_JSON, "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return Object.keys(parsed.dependencies ?? {});
  } catch {
    return [];
  }
}

/**
 * Check whether a package is installed by looking for its directory on disk.
 *
 * `require.resolve` is unreliable here because Next.js / Turbopack shims it in
 * the bundled server runtime, so dynamically-installed packages are invisible to
 * it even though they exist on disk.  A direct filesystem check is immune to
 * bundler transformations and works consistently across dev, production, and
 * Electron builds.
 */
function canResolvePackage(packageName: string, nodeModulesDirs: string[]): boolean {
  for (const dir of nodeModulesDirs) {
    if (existsSync(join(dir, packageName, "package.json"))) {
      return true;
    }
    // Some packages may not have package.json at the expected path (e.g.
    // symlinked workspaces) — fall back to checking the directory itself.
    if (existsSync(join(dir, packageName))) {
      return true;
    }
  }
  return false;
}

export async function validateWorkspaceDependencies(
  componentCode: string,
): Promise<DependencyValidationResult> {
  const manifestPackages = await readSandboxManifestPackages();
  const importedPackages = extractImportedPackages(componentCode);
  const knownWorkspacePackages = new Set(DESIGN_LIBRARIES.map((library) => library.package));

  const PROJECT_NODE_MODULES = join(PROJECT_ROOT, "node_modules");

  const missingManifestPackages = manifestPackages.filter(
    (packageName) => !canResolvePackage(packageName, [SANDBOX_NODE_MODULES]),
  );

  // An imported package belongs to the workspace if it appears in the sandbox
  // manifest OR the known design-library registry.  No hardcoded package names
  // — the LLM decides what to install; this layer only validates resolution.
  const manifestSet = new Set(manifestPackages);
  const importedWorkspacePackages = importedPackages.filter(
    (packageName) =>
      manifestSet.has(packageName) || knownWorkspacePackages.has(packageName),
  );

  const missingImportedPackages = importedWorkspacePackages.filter(
    (packageName) => !canResolvePackage(packageName, [SANDBOX_NODE_MODULES, PROJECT_NODE_MODULES]),
  );

  const missingPackages = uniqueStrings([
    ...missingManifestPackages,
    ...missingImportedPackages,
  ]);

  return {
    manifestPackages,
    importedPackages,
    checkedPackages: uniqueStrings([...manifestPackages, ...importedWorkspacePackages]),
    missingManifestPackages,
    missingImportedPackages,
    missingPackages,
  };
}

function extractPackageNames(specs: string[]): string[] {
  return specs.map((spec) => {
    if (spec.startsWith("@")) {
      const slashIndex = spec.indexOf("/");
      if (slashIndex === -1) {
        return spec;
      }

      const afterSlash = spec.slice(slashIndex + 1);
      const versionIndex = afterSlash.indexOf("@");
      return versionIndex === -1 ? spec : spec.slice(0, slashIndex + 1 + versionIndex);
    }

    const versionIndex = spec.indexOf("@");
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  });
}

export async function installSandboxPackages(
  packages: string[],
): Promise<DependencyInstallResult> {
  const specs = uniqueStrings(
    packages
      .map((packageName) => validatePackageSpec(packageName))
      .filter((result) => result.valid)
      .map((result) => result.spec),
  );

  if (specs.length === 0) {
    return {
      attempted: false,
      success: true,
      packages: [],
      packageNames: [],
    };
  }

  const packageNames = extractPackageNames(specs);

  const doInstall = async () => {
    await ensureSandboxDir();
    const { command, options: platformOptions } = getNpmExecConfig();
    await execFileAsync(
      command,
      ["install", "--save", "--ignore-scripts", ...specs],
      {
        cwd: SANDBOX_DIR,
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: "development" },
        ...platformOptions,
      },
    );
  };

  const myInstall = (installLock ?? Promise.resolve())
    .catch(() => {})
    .then(doInstall);
  installLock = myInstall;

  try {
    await myInstall;
  } catch (error) {
    return {
      attempted: true,
      success: false,
      packages: specs,
      packageNames,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  for (const packageName of packageNames) {
    registerRuntimeLibrary({
      name: packageName,
      package: packageName,
      description: `Installed package: ${packageName}`,
      importExamples: [`import ... from "${packageName}"`],
    });
  }

  await detectAvailableLibraries();

  return {
    attempted: true,
    success: true,
    packages: specs,
    packageNames,
  };
}

/**
 * Install packages in a project worktree directory.
 *
 * Unlike `installSandboxPackages` which installs into the design sandbox,
 * this installs into the project's own node_modules within the worktree.
 * Respects the project's package manager (npm, yarn, pnpm, bun).
 */
export async function installProjectPackages(
  worktreePath: string,
  packages: string[],
): Promise<DependencyInstallResult> {
  const specs = uniqueStrings(
    packages
      .map((packageName) => validatePackageSpec(packageName))
      .filter((result) => result.valid)
      .map((result) => result.spec),
  );

  if (specs.length === 0) {
    return {
      attempted: false,
      success: true,
      packages: [],
      packageNames: [],
    };
  }

  const packageNames = extractPackageNames(specs);

  try {
    // Detect package manager from lockfiles
    const pm = detectPackageManager(worktreePath);
    const installCmd = getInstallCommand(pm, specs);

    const { command, options: platformOptions } = pm === "npm"
      ? getNpmExecConfig()
      : { command: pm, options: IS_WINDOWS ? { shell: true } as ExecFileOptions : {} };

    await execFileAsync(
      command,
      installCmd.args,
      {
        cwd: worktreePath,
        timeout: 180_000,
        env: { ...process.env, NODE_ENV: "development" },
        ...platformOptions,
      },
    );

    return {
      attempted: true,
      success: true,
      packages: specs,
      packageNames,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      packages: specs,
      packageNames,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Detect which package manager a project uses based on lockfiles. */
function detectPackageManager(projectRoot: string): "npm" | "yarn" | "pnpm" | "bun" {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectRoot, "bun.lockb")) || existsSync(join(projectRoot, "bun.lock"))) return "bun";
  return "npm";
}

/** Build the install command args for a given package manager. */
function getInstallCommand(pm: "npm" | "yarn" | "pnpm" | "bun", specs: string[]): { args: string[] } {
  switch (pm) {
    case "pnpm":
      return { args: ["add", ...specs] };
    case "yarn":
      return { args: ["add", ...specs] };
    case "bun":
      return { args: ["add", ...specs] };
    case "npm":
    default:
      return { args: ["install", "--save", "--ignore-scripts", ...specs] };
  }
}

/**
 * Validate that imported packages resolve in the project's node_modules.
 * Similar to validateWorkspaceDependencies but checks project context.
 */
export async function validateProjectDependencies(
  componentCode: string,
  projectNodeModulesPath: string,
): Promise<DependencyValidationResult> {
  const importedPackages = extractImportedPackages(componentCode);

  // Read project's package.json for manifest
  let manifestPackages: string[] = [];
  const projectPkgJsonPath = join(projectNodeModulesPath, "..", "package.json");
  try {
    const raw = await fs.readFile(projectPkgJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    manifestPackages = [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ];
  } catch {
    // No package.json or invalid
  }

  const missingImportedPackages = importedPackages.filter(
    (packageName) => !canResolvePackage(packageName, [projectNodeModulesPath]),
  );

  const missingManifestPackages = manifestPackages.filter(
    (packageName) => !canResolvePackage(packageName, [projectNodeModulesPath]),
  );

  const missingPackages = uniqueStrings([
    ...missingManifestPackages,
    ...missingImportedPackages,
  ]);

  return {
    manifestPackages,
    importedPackages,
    checkedPackages: uniqueStrings([...manifestPackages, ...importedPackages]),
    missingManifestPackages,
    missingImportedPackages,
    missingPackages,
  };
}
