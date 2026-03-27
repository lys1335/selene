/**
 * Bundled-runtime detection and safe environment building.
 * Handles packaged Electron builds that include standalone Node.js/npm/npx binaries.
 *
 * Extracted from executor.ts to isolate platform/path detection concerns.
 */

import { existsSync } from "fs";
import { basename, isAbsolute, join } from "path";
import { tmpdir } from "os";
import { getResolvedShellEnvironment } from "@/lib/shell-env/resolver";

/**
 * Keys that are always stripped from the child environment, regardless of
 * whether we're using shell env or falling back to process.env.
 * These are Electron/Selene internals that should never reach user commands.
 */
const ALWAYS_BLOCKED_ENV_KEYS = new Set([
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_NO_ATTACH_CONSOLE",
    "ELECTRON_ENABLE_LOGGING",
    "SELENE_PRODUCTION_BUILD",
    "TURBOPACK",
    "NEXT_RUNTIME",
    "NEXT_DEPLOYMENT_ID",
    "PORT",
]);

/**
 * Additional keys to strip when falling back to process.env (i.e. when shell
 * env resolution failed). These are set by the Electron/Next.js runtime and
 * would break user dev tooling if they leaked through.
 *
 * When shell env IS available, these are NOT stripped — the shell env was
 * captured from a clean login shell, so if NODE_ENV is present it's because
 * the user's rcfiles explicitly set it, which is the correct behavior.
 */
const PROCESS_ENV_FALLBACK_BLOCKED_KEYS = new Set([
    "NODE_ENV",
]);

/**
 * Prefix patterns for env vars that should never leak to child processes.
 * All __NEXT_* vars are internal to the running Next.js instance — they
 * control standalone config, processed env markers, React bundle paths, etc.
 * Leaking them causes child Next.js processes to use Selene's config instead
 * of their own, which crashes with path resolution errors.
 *
 * Note: We intentionally do NOT block NEXT_PUBLIC_* or generic NEXT_* vars,
 * because those may be user-facing env vars. We only strip known Next.js
 * runtime internals via __NEXT_* and NEXT_PRIVATE_* prefixes.
 */
const BLOCKED_ENV_PREFIXES = ["__NEXT_", "NEXT_PRIVATE_"];

export function sanitizeEnvironment(
    env: Record<string, string | undefined>,
    extraBlockedKeys?: Set<string>,
): Record<string, string | undefined> {
    const sanitized = { ...env };
    for (const key of ALWAYS_BLOCKED_ENV_KEYS) {
        delete sanitized[key];
    }
    if (extraBlockedKeys) {
        for (const key of extraBlockedKeys) {
            delete sanitized[key];
        }
    }
    for (const key of Object.keys(sanitized)) {
        if (BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            delete sanitized[key];
        }
    }
    return sanitized;
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
    /** Directory containing the real ffmpeg/ffprobe binaries and their dylibs */
    ffmpegDir: string | null;
};

export function getResourcesPath(): string | null {
    return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
        || process.env.ELECTRON_RESOURCES_PATH
        || null;
}

export function getBundledRuntimeInfo(): BundledRuntimeInfo {
    const resourcesPath = getResourcesPath();
    const nodeBinDir = resourcesPath ? join(resourcesPath, "standalone", "node_modules", ".bin") : null;
    const toolsBinDir = resourcesPath ? join(resourcesPath, "standalone", "tools", "bin") : null;
    const ripgrepBinDir = resourcesPath
        ? join(resourcesPath, "standalone", "node_modules", "@vscode", "ripgrep", "bin")
        : null;
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
        isProductionBuild: !!resourcesPath && process.env.ELECTRON_IS_DEV !== "1" && process.env.NODE_ENV !== "development",
        nodeBinDir,
        toolsBinDir,
        ripgrepBinDir,
        bundledBinDirs,
        bundledNodePath: bundledNodePath && existsSync(bundledNodePath) ? bundledNodePath : null,
        bundledNpmCliPath: bundledNpmCliPath && existsSync(bundledNpmCliPath) ? bundledNpmCliPath : null,
        bundledNpxCliPath: bundledNpxCliPath && existsSync(bundledNpxCliPath) ? bundledNpxCliPath : null,
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

export function prependBundledPaths(pathValue: string, runtime: BundledRuntimeInfo): string {
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
 *      terminal window. process.env is NOT mixed in.
 *
 *   2. When shell env is unavailable (Windows, EBADF, resolution failure) —
 *      fall back to process.env with aggressive sanitization to strip
 *      runtime-specific vars that would break user commands.
 *
 * In both cases, bundled binary dirs are prepended to PATH and a small set
 * of platform-essential vars (ELECTRON_RESOURCES_PATH, TERM) are set.
 */
export function buildSafeEnvironment(runtime: BundledRuntimeInfo): Record<string, string | undefined> {
    const shellEnv = getResolvedShellEnvironment();
    const shellEnvAvailable = Object.keys(shellEnv).length > 0;

    let baseEnv: Record<string, string | undefined>;

    if (shellEnvAvailable) {
        // Shell env IS the user's environment — captured from a clean login
        // shell with no Electron/Next.js vars. Use it directly.
        baseEnv = { ...shellEnv } as Record<string, string | undefined>;
    } else {
        // Fallback: shell env resolution failed. Use process.env but apply
        // extra sanitization to strip runtime-specific vars.
        baseEnv = { ...process.env };
    }

    // On Windows, process.env is a case-insensitive Proxy, but spreading it
    // creates a plain (case-sensitive) object where PATH is typically stored
    // as "Path". Collect the value case-insensitively (last match wins) and
    // remove all variants to avoid duplicate/conflicting PATH entries.
    let currentPath = "";
    if (process.platform === "win32") {
        for (const key of Object.keys(baseEnv)) {
            if (key.toUpperCase() === "PATH") {
                currentPath = (baseEnv[key] as string) || currentPath;
                delete baseEnv[key];
            }
        }
    } else {
        currentPath = (baseEnv.PATH as string) || "";
    }
    const pathValue = prependBundledPaths(currentPath, runtime);

    if (runtime.bundledBinDirs.length > 0) {
        console.log(`[Command Executor] Prepending bundled binaries to PATH: ${runtime.bundledBinDirs.join(", ")}`);
    }

    // On Windows, expose TMPDIR so scripts using $TMPDIR or process.env.TMPDIR
    // resolve to the correct Windows temp directory instead of failing on /tmp.
    const tmpOverrides: Record<string, string> = {};
    if (process.platform === "win32") {
        tmpOverrides.TMPDIR = tmpdir();
    }

    // When falling back to process.env, also strip NODE_ENV and other
    // runtime vars that would break dev tooling. When shell env is the
    // source, these are either absent (clean bootstrap) or intentionally
    // set by the user's rcfiles — both are correct.
    const extraBlocked = shellEnvAvailable
        ? undefined
        : PROCESS_ENV_FALLBACK_BLOCKED_KEYS;

    return sanitizeEnvironment({
        ...baseEnv,
        ...tmpOverrides,
        PATH: pathValue,
        TERM: baseEnv.TERM && baseEnv.TERM !== "dumb" ? baseEnv.TERM : "xterm-256color",
        HOME: baseEnv.HOME || baseEnv.USERPROFILE,
        USER: baseEnv.USER || baseEnv.USERNAME,
        // Selene-specific: needed for bundled binary resolution in child processes
        ELECTRON_RESOURCES_PATH: process.env.ELECTRON_RESOURCES_PATH || runtime.resourcesPath || undefined,
    }, extraBlocked);
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
    const effectivePathHead = (env.PATH || "").split(pathSeparator).slice(0, 5).join("\n  ");
    const lines = [
        `Mode: ${runtime.isProductionBuild ? "packaged" : "development"}`,
        `resourcesPath: ${runtime.resourcesPath ?? "<none>"}`,
        `bundled node bin dir: ${runtime.nodeBinDir ?? "<none>"} (exists=${runtime.nodeBinDir ? existsSync(runtime.nodeBinDir) : false})`,
        `bundled tools bin dir: ${runtime.toolsBinDir ?? "<none>"} (exists=${runtime.toolsBinDir ? existsSync(runtime.toolsBinDir) : false})`,
        `bundled ripgrep bin dir: ${runtime.ripgrepBinDir ?? "<none>"} (exists=${runtime.ripgrepBinDir ? existsSync(runtime.ripgrepBinDir) : false})`,
        `bundled node binary: ${runtime.bundledNodePath ?? "<missing>"}`,
        `bundled npm cli: ${runtime.bundledNpmCliPath ?? "<missing>"}`,
        `bundled npx cli: ${runtime.bundledNpxCliPath ?? "<missing>"}`,
        `effective PATH prefix:\n  ${effectivePathHead || "<empty>"}`,
    ];

    if (resolution) lines.push(`command resolution: ${resolution}`);
    lines.push(`requested command: ${command}`);
    return lines.join("\n");
}
