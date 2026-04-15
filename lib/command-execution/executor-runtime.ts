/**
 * Bundled-runtime detection and safe environment building.
 * Handles packaged Electron builds that include standalone Node.js/npm/npx binaries.
 *
 * Extracted from executor.ts to isolate platform/path detection concerns.
 */

import { existsSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, isAbsolute, join } from "path";
import {
    buildEnvironmentForTarget,
    initializeProcessEnvironment,
    sanitizeEnvironment,
} from "@/lib/process-env/policy";

/**
 * Explicitly normalize the parent process environment before command execution.
 *
 * spawn() with shell:false uses the parent process PATH to locate executables,
 * so Windows callers must repair PATH on demand instead of relying on import-time
 * side effects.
 */
export function initializeCommandExecutionProcessEnv(): NodeJS.ProcessEnv {
    return initializeProcessEnvironment({
        filterGitBashPath: false,
        ensureComSpec: true,
        ensureSystemPaths: true,
    });
}

export type BundledRuntimeInfo = {
    resourcesPath: string | null;
    isProductionBuild: boolean;
    nodeBinDir: string | null;
    toolsBinDir: string | null;
    ripgrepBinDir: string | null;
    bundledBinDirs: string[];
    bundledNodePath: string | null;
    bundledNpmCliPath: string | null;
    bundledNpxCliPath: string | null;
    hostPathPreserved: boolean;
    /** Directory containing the real ffmpeg/ffprobe binaries and their dylibs */
    ffmpegDir: string | null;
};

function getResourcesPath(): string | null {
    return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
        || process.env.ELECTRON_RESOURCES_PATH
        || null;
}

export function getBundledRuntimeInfo(): BundledRuntimeInfo {
    const resourcesPath = getResourcesPath();
    const nodeBinDir = resourcesPath ? join(resourcesPath, "standalone", "node_modules", ".bin") : null;
    const toolsBinDir = resourcesPath ? join(resourcesPath, "standalone", "tools", "bin") : null;
    // In production builds, ripgrep lives inside the standalone node_modules.
    // In dev mode (no resourcesPath), resolve it from the workspace node_modules
    // so `rg` is available in bash/executeCommand without requiring a global install.
    let ripgrepBinDir: string | null = resourcesPath
        ? join(resourcesPath, "standalone", "node_modules", "@vscode", "ripgrep", "bin")
        : null;
    if (!ripgrepBinDir) {
        try {
            const { rgPath } = require("@vscode/ripgrep") as { rgPath: string };
            const candidate = dirname(rgPath);
            if (existsSync(candidate)) {
                ripgrepBinDir = candidate;
            }
        } catch { /* @vscode/ripgrep not installed — skip */ }
    }
    const bundledNodePath = nodeBinDir
        ? join(nodeBinDir, process.platform === "win32" ? "node.exe" : "node")
        : null;
    const bundledNpmCliPath = resourcesPath
        ? join(resourcesPath, "standalone", "node_modules", "npm", "bin", "npm-cli.js")
        : null;
    const bundledNpxCliPath = resourcesPath
        ? join(resourcesPath, "standalone", "node_modules", "npm", "bin", "npx-cli.js")
        : null;

    // Reuse the existing vscode-ripgrep payload so shell `rg` works without bundling a duplicate binary.
    const bundledCandidates = [nodeBinDir, toolsBinDir, ripgrepBinDir].filter((candidate): candidate is string => Boolean(candidate));
    const bundledBinDirs = bundledCandidates.filter((candidate) => existsSync(candidate));

    // Detect the ffmpeg binary from ffmpeg-static package.
    const ffmpegDir = resourcesPath ? detectFfmpegDir(join(resourcesPath, "standalone", "node_modules")) : null;

    return {
        resourcesPath,
        // Use resourcesPath + ELECTRON_IS_DEV as production signals — not NODE_ENV,
        // which can be stale/leaked from parent processes. app.isPackaged is the
        // Electron-recommended approach; resourcesPath is its equivalent in
        // renderer/server processes.
        isProductionBuild: !!resourcesPath && process.env.ELECTRON_IS_DEV !== "1",
        nodeBinDir,
        toolsBinDir,
        ripgrepBinDir,
        bundledBinDirs,
        bundledNodePath: bundledNodePath && existsSync(bundledNodePath) ? bundledNodePath : null,
        bundledNpmCliPath: bundledNpmCliPath && existsSync(bundledNpmCliPath) ? bundledNpmCliPath : null,
        bundledNpxCliPath: bundledNpxCliPath && existsSync(bundledNpxCliPath) ? bundledNpxCliPath : null,
        hostPathPreserved: false,
        ffmpegDir,
    };
}

/**
 * Detect the directory containing the ffmpeg binary from ffmpeg-static.
 * Returns the directory path if found, null otherwise.
 */
function detectFfmpegDir(nodeModulesPath: string): string | null {
    const ffmpegStaticDir = join(nodeModulesPath, "ffmpeg-static");
    const ffmpegBinaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const ffmpegStaticBinary = join(ffmpegStaticDir, ffmpegBinaryName);
    if (existsSync(ffmpegStaticBinary)) return ffmpegStaticDir;

    // Also check .bin directory where electron-prepare copies the binary
    const binDir = join(nodeModulesPath, ".bin");
    const binFfmpeg = join(binDir, ffmpegBinaryName);
    if (existsSync(binFfmpeg)) return binDir;

    return null;
}

function prependBundledPaths(pathValue: string, runtime: BundledRuntimeInfo): string {
    if (runtime.bundledBinDirs.length === 0) return pathValue;
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    return `${runtime.bundledBinDirs.join(pathSeparator)}${pathSeparator}${pathValue}`;
}

/**
 * Build the environment for command execution that mirrors what the user gets
 * in their terminal.
 *
 * Strategy:
 *   1. When shell env is available (non-empty) — use it as the PRIMARY source.
 *      The resolver captures it from a clean login shell (no Electron/Next.js
 *      contamination), so it's exactly what the user would get in a new
 *      terminal window.
 *
 *   2. In packaged builds, append vetted host PATH fallback segments after the
 *      shell PATH so bundled/runtime-installed tools remain reachable.
 *
 *   3. When shell env is unavailable (Windows, EBADF, resolution failure) —
 *      fall back to process.env with aggressive sanitization to strip
 *      runtime-specific vars that would break user commands.
 *
 * In both cases, bundled binary dirs are prepended to PATH and a small set
 * of platform-essential vars (ELECTRON_RESOURCES_PATH, TERM) are set.
 */
export function buildSafeEnvironment(runtime: BundledRuntimeInfo): Record<string, string | undefined> {
    const result = buildEnvironmentForTarget({
        target: "execute-command",
        runtime: {
            ...runtime,
            shouldMergeHostPathFallback: runtime.isProductionBuild,
        },
    });
    runtime.hostPathPreserved = result.hostPathPreserved;

    if (runtime.bundledBinDirs.length > 0) {
        console.log(`[Command Executor] Prepending bundled binaries to PATH: ${runtime.bundledBinDirs.join(", ")}`);
    }

    return result.env;
}

// ── Unix-to-Windows path normalization ────────────────────────────────────────

/**
 * Unix temp-dir prefixes that should be mapped to os.tmpdir() on Windows.
 * Longer prefixes first for clarity (order doesn't affect correctness).
 */
const UNIX_TEMP_PREFIXES = ["/var/tmp", "/tmp"];

/**
 * Translate a single Unix-style temp path to the Windows equivalent.
 * Only active on Windows; returns the argument unchanged on other platforms.
 *
 * Handles:
 *   /tmp/file.json           → C:\Users\...\AppData\Local\Temp\file.json
 *   /var/tmp/data.json       → C:\Users\...\AppData\Local\Temp\data.json
 *   --output=/tmp/file.json  → --output=C:\Users\...\AppData\Local\Temp\file.json
 */
export function normalizeUnixPath(arg: string): string {
    if (process.platform !== "win32") return arg;

    // Handle --flag=/tmp/... style arguments
    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0 && arg.startsWith("-")) {
        const prefix = arg.slice(0, eqIndex + 1);
        const value = arg.slice(eqIndex + 1);
        const normalized = normalizeUnixPath(value);
        return normalized !== value ? prefix + normalized : arg;
    }

    for (const unixPrefix of UNIX_TEMP_PREFIXES) {
        if (arg === unixPrefix || arg.startsWith(unixPrefix + "/")) {
            const remainder = arg.slice(unixPrefix.length); // "" or "/file.json"
            return join(tmpdir(), remainder.replace(/^\//, ""));
        }
    }

    return arg;
}

/**
 * Normalize all Unix temp paths in an args array.
 */
export function normalizeArgs(args: string[]): string[] {
    if (process.platform !== "win32") return args;
    return args.map(normalizeUnixPath);
}

export function normalizeExecutable(command: string): string {
    return basename(command.trim()).toLowerCase().replace(/\.(?:cmd|bat|exe)$/i, "");
}

export function resolveBundledNodeCommand(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    runtime: BundledRuntimeInfo,
): { command: string; args: string[]; env: NodeJS.ProcessEnv; resolution: string | null } {
    if (!runtime.resourcesPath) {
        return { command, args, env, resolution: null };
    }

    // Handle absolute paths pointing to the broken .bin/ffmpeg JS wrapper.
    // The npm wrapper is a JS script that fails with ENOEXEC under spawn(shell:false).
    // Redirect to the real binary if we detect this pattern.
    if (isAbsolute(command)) {
        const base = normalizeExecutable(command);
        if ((base === "ffmpeg" || base === "ffprobe") && runtime.ffmpegDir) {
            const isBrokenWrapper = command.includes("node_modules/.bin/");
            if (isBrokenWrapper) {
                const realBinary = join(runtime.ffmpegDir, base);
                if (existsSync(realBinary)) {
                    const envWithLibPath = setLibraryPath(env, runtime.ffmpegDir);
                    return { command: realBinary, args, env: envWithLibPath, resolution: `redirected broken .bin/${base} wrapper to real binary` };
                }
            }
        }
        return { command, args, env, resolution: null };
    }

    const normalized = normalizeExecutable(command);
    if (normalized === "node" && runtime.bundledNodePath) {
        return { command: runtime.bundledNodePath, args, env, resolution: `resolved '${command}' to bundled node` };
    }

    if (normalized === "npm" && runtime.bundledNodePath && runtime.bundledNpmCliPath) {
        return {
            command: runtime.bundledNodePath,
            args: [runtime.bundledNpmCliPath, ...args],
            env,
            resolution: "resolved 'npm' via bundled node + npm-cli.js",
        };
    }

    if (normalized === "npx" && runtime.bundledNodePath && runtime.bundledNpxCliPath) {
        return {
            command: runtime.bundledNodePath,
            args: [runtime.bundledNpxCliPath, ...args],
            env,
            resolution: "resolved 'npx' via bundled node + npx-cli.js",
        };
    }

    // Resolve apply_patch to its Node.js script.
    // In production builds, toolsBinDir is in PATH so apply_patch.cmd/.sh is found
    // automatically. In dev mode, toolsBinDir is null and the bare command fails on
    // Windows (cmd.exe can't find it). Resolve to `node scripts/bundled-tools/apply_patch.js`.
    if (normalized === "apply_patch") {
        // Production: check toolsBinDir first
        if (runtime.toolsBinDir) {
            const cmdExt = process.platform === "win32" ? ".cmd" : "";
            const bundledPath = join(runtime.toolsBinDir, `apply_patch${cmdExt}`);
            if (existsSync(bundledPath)) {
                return { command: bundledPath, args, env, resolution: `resolved 'apply_patch' to bundled binary at ${runtime.toolsBinDir}` };
            }
        }
        // Dev mode fallback: run via node + scripts/bundled-tools/apply_patch.js
        // In production bundles (Electron), __dirname points to electron-dist/
        // and the relative walk would be wrong. Only attempt this when toolsBinDir
        // is absent (i.e. we're in a dev environment without bundled binaries).
        if (!runtime.toolsBinDir) {
            // Walk up from lib/command-execution/ to repo root
            const projectRoot = join(__dirname, "..", "..");
            const devScript = join(projectRoot, "scripts", "bundled-tools", "apply_patch.js");
            if (existsSync(devScript)) {
                const nodeCmd = runtime.bundledNodePath || "node";
                return {
                    command: nodeCmd,
                    args: [devScript, ...args],
                    env,
                    resolution: `resolved 'apply_patch' via node + ${devScript}`,
                };
            }
        }
        // Last resort: return as-is and let PATH resolution attempt it
        return { command, args, env, resolution: null };
    }

    // Resolve ffmpeg/ffprobe to the bundled binary from ffmpeg-static.
    if ((normalized === "ffmpeg" || normalized === "ffprobe") && runtime.ffmpegDir) {
        const realBinary = join(runtime.ffmpegDir, normalized);
        if (existsSync(realBinary)) {
            const envWithLibPath = setLibraryPath(env, runtime.ffmpegDir);
            return { command: realBinary, args, env: envWithLibPath, resolution: `resolved '${command}' to bundled ${normalized} at ${runtime.ffmpegDir}` };
        }
    }

    return { command, args, env, resolution: null };
}

/**
 * Set the dynamic library search path so ffmpeg can find its co-located dylibs/shared objects.
 * macOS uses DYLD_LIBRARY_PATH, Linux uses LD_LIBRARY_PATH.
 */
function setLibraryPath(env: NodeJS.ProcessEnv, libDir: string): NodeJS.ProcessEnv {
    const envKey = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    const existing = env[envKey];
    return {
        ...env,
        [envKey]: existing ? `${libDir}:${existing}` : libDir,
    };
}

export function buildNotFoundDiagnostic(
    command: string,
    runtime: BundledRuntimeInfo,
    env: NodeJS.ProcessEnv,
    resolution: string | null,
): string {
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    const pathSegments = (env.PATH || "").split(pathSeparator).filter(Boolean);
    const effectivePathHead = pathSegments.slice(0, 5).join("\n  ");
    const lines = [
        `Mode: ${runtime.isProductionBuild ? "packaged" : "development"}`,
        `resourcesPath: ${runtime.resourcesPath ?? "<none>"}`,
        `bundled node bin dir: ${runtime.nodeBinDir ?? "<none>"} (exists=${runtime.nodeBinDir ? existsSync(runtime.nodeBinDir) : false})`,
        `bundled tools bin dir: ${runtime.toolsBinDir ?? "<none>"} (exists=${runtime.toolsBinDir ? existsSync(runtime.toolsBinDir) : false})`,
        `bundled ripgrep bin dir: ${runtime.ripgrepBinDir ?? "<none>"} (exists=${runtime.ripgrepBinDir ? existsSync(runtime.ripgrepBinDir) : false})`,
        `bundled node binary: ${runtime.bundledNodePath ?? "<missing>"}`,
        `bundled npm cli: ${runtime.bundledNpmCliPath ?? "<missing>"}`,
        `bundled npx cli: ${runtime.bundledNpxCliPath ?? "<missing>"}`,
        `host PATH fallback preserved: ${runtime.hostPathPreserved ? "yes" : "no"}`,
        `effective PATH prefix:\n  ${effectivePathHead || "<empty>"}`,
    ];

    if (resolution) lines.push(`command resolution: ${resolution}`);
    lines.push(`requested command: ${command}`);
    return lines.join("\n");
}
