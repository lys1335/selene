import { spawnSync, execSync } from "child_process";
import * as fs from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SHELL_RESOLVE_TIMEOUT_MS = 3000;

/**
 * Env vars that should be stripped from the captured shell environment.
 * These are Electron/Selene internals that can confuse child Node.js processes.
 */
const BLOCKED_ENV_KEYS = new Set([
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
 * Prefix patterns stripped during shell-env capture. Any env var starting with
 * these belongs to the running Next.js host process and must not be inherited
 * by user-facing child commands.
 */
const BLOCKED_ENV_PREFIXES = ["__NEXT_", "NEXT_PRIVATE_"];

let cachedShellEnv: Record<string, string> | null = null;
let shellEnvResolutionAttempted = false;
let lastResolutionAttemptMs = 0;

/** Minimum interval between retry attempts when previous resolution returned empty. */
const RETRY_INTERVAL_MS = 5000;

/**
 * Build a minimal, clean environment for spawning the user's login shell.
 *
 * The goal is to start the shell in the same state as opening a fresh terminal
 * window — no Electron, Next.js, or Selene runtime vars. The login shell's
 * rc-files (.zshrc, .zprofile, .bashrc, .bash_profile, etc.) run on top of
 * this baseline and produce the user's real working environment.
 *
 * We intentionally exclude vars like NODE_ENV, __NEXT_PRIVATE_*, and
 * SELENE_PRODUCTION_BUILD because they come from the Electron/Next.js
 * runtime and would contaminate the captured environment.
 */
function getMinimalShellBootstrapEnv(): Record<string, string> {
    const env: Record<string, string> = {
        // Base PATH — login shell will prepend user-specific dirs via rcfiles.
        // On macOS, /usr/libexec/path_helper (called from /etc/zprofile) also
        // contributes entries from /etc/paths and /etc/paths.d/*.
        PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        TERM: "xterm-256color",
    };

    // Essentials for shell startup and rcfile sourcing.
    const passthrough: (keyof NodeJS.ProcessEnv)[] = [
        "HOME", "USER", "LOGNAME", "SHELL",
        // Locale — some shells and tools behave differently without these
        "LANG", "LC_ALL", "LC_CTYPE",
        // XDG dirs affect config file locations for many tools
        "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
    ];

    for (const key of passthrough) {
        const value = process.env[key];
        if (value) env[key] = value;
    }

    return env;
}

function getCandidateShells(): string[] {
    const candidates = [process.env.SHELL];

    if (process.platform === "darwin") {
        candidates.push("/bin/zsh", "/bin/bash", "/bin/sh");
    } else if (process.platform === "linux") {
        candidates.push("/bin/bash", "/bin/sh");
    }

    const unique = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate || !candidate.startsWith("/")) continue;
        unique.add(candidate);
    }

    return [...unique];
}

function parseNullSeparatedEnvironment(raw: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    const records = raw.split("\0");

    for (const record of records) {
        if (!record) continue;
        const separatorIndex = record.indexOf("=");
        if (separatorIndex <= 0) continue;

        const key = record.slice(0, separatorIndex);
        const value = record.slice(separatorIndex + 1);

        if (!key || BLOCKED_ENV_KEYS.has(key)) continue;
        if (BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
        parsed[key] = value;
    }

    return parsed;
}

/**
 * Resolve a clean Windows environment by reading Machine + User env vars
 * from the registry via PowerShell. This gives us the real system PATH
 * (Docker, system32, etc.) without npm lifecycle pollution or MSYS2 changes.
 *
 * Falls back to {} if PowerShell is unavailable or times out.
 */
function resolveWindowsShellEnvironment(): Record<string, string> {
    // Strategy 1: Use PowerShell to read env vars directly from the registry.
    // This gives the clean system+user environment without npm/MSYS2 pollution.
    const psResult = resolveWindowsViaPs();
    if (psResult) return psResult;

    // Strategy 2: Fall back to cmd.exe /c set (inherits process.env but still
    // better than raw process.env because cmd.exe normalises PATH casing).
    const cmdResult = resolveWindowsViaCmd();
    if (cmdResult) return cmdResult;

    console.warn("[Shell Env] All Windows resolution strategies failed, using process.env fallback");
    return {};
}

/**
 * Read Machine + User env vars from the Windows registry via PowerShell.
 * Returns null on failure so the caller can try the next strategy.
 */
function resolveWindowsViaPs(): Record<string, string> | null {
    try {
        const systemRoot = process.env.SystemRoot || "C:\\WINDOWS";
        const psPath = join(systemRoot, "system32", "WindowsPowerShell", "v1.0", "powershell.exe");

        // PowerShell script that reads Machine + User env vars from the registry
        // and outputs them as NUL-separated KEY=VALUE pairs (same format as `env -0`).
        // User vars override Machine vars. Path is special-cased: Machine Path + User Path.
        const psScript = [
            "$out = @{}",
            "[Environment]::GetEnvironmentVariables('Machine').GetEnumerator() | ForEach-Object { $out[$_.Key] = $_.Value }",
            "[Environment]::GetEnvironmentVariables('User').GetEnumerator() | ForEach-Object {",
            "  if ($_.Key -eq 'Path') { $out['Path'] = $out['Path'] + ';' + $_.Value }",
            "  else { $out[$_.Key] = $_.Value }",
            "}",
            "$out.GetEnumerator() | ForEach-Object { [Console]::Write(\"$($_.Key)=$($_.Value)`0\") }",
        ].join("; ");

        const result = spawnSync(psPath, [
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-Command", psScript,
        ], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: SHELL_RESOLVE_TIMEOUT_MS,
            windowsHide: true,
        });

        if (result.error || result.status !== 0 || !result.stdout) {
            console.warn("[Shell Env] PowerShell resolution failed:", result.error?.message || `exit ${result.status}`);
            return null;
        }

        const parsed = parseNullSeparatedEnvironment(result.stdout);
        if (Object.keys(parsed).length > 0) {
            console.log(`[Shell Env] Resolved ${Object.keys(parsed).length} Windows env vars via PowerShell (registry)`);
            return parsed;
        }
    } catch (err) {
        console.warn("[Shell Env] PowerShell resolution error:", err);
    }
    return null;
}

/**
 * Fallback: capture env from cmd.exe. This inherits the current process env
 * (including npm PATH modifications), but normalises casing and avoids MSYS2
 * shell-level transformations. Better than raw process.env in dev mode.
 */
function resolveWindowsViaCmd(): Record<string, string> | null {
    try {
        const comspec = process.env.ComSpec || "C:\\WINDOWS\\system32\\cmd.exe";
        const result = spawnSync(comspec, ["/c", "set"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: SHELL_RESOLVE_TIMEOUT_MS,
            windowsHide: true,
        });

        if (result.error || result.status !== 0 || !result.stdout) {
            console.warn("[Shell Env] cmd.exe resolution failed:", result.error?.message || `exit ${result.status}`);
            return null;
        }

        // `set` output is newline-separated KEY=VALUE pairs. Parse like env -0 but with \n.
        const parsed: Record<string, string> = {};
        for (const line of result.stdout.split(/\r?\n/)) {
            const eqIdx = line.indexOf("=");
            if (eqIdx <= 0) continue;
            const key = line.slice(0, eqIdx);
            const value = line.slice(eqIdx + 1);
            if (BLOCKED_ENV_KEYS.has(key)) continue;
            if (BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
            parsed[key] = value;
        }

        if (Object.keys(parsed).length > 0) {
            console.log(`[Shell Env] Resolved ${Object.keys(parsed).length} Windows env vars via cmd.exe`);
            return parsed;
        }
    } catch (err) {
        console.warn("[Shell Env] cmd.exe resolution error:", err);
    }
    return null;
}

function resolveShellEnvironmentOnce(): Record<string, string> {
    if (process.platform === "win32") {
        return resolveWindowsShellEnvironment();
    }

    // Start the login shell with a clean env so Electron/Next.js vars
    // don't leak into the captured environment.
    const bootstrapEnv = getMinimalShellBootstrapEnv() as NodeJS.ProcessEnv;

    // First try: normal spawnSync with pipes (works in dev, fails in Electron prod)
    for (const shellPath of getCandidateShells()) {
        try {
            const probe = spawnSync(shellPath, ["-ilc", "env -0"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: SHELL_RESOLVE_TIMEOUT_MS,
                env: bootstrapEnv,
            });

            if (probe.error || probe.status !== 0 || !probe.stdout) {
                // If EBADF, break out and try the file-based fallback
                if (probe.error && (probe.error as NodeJS.ErrnoException).code === "EBADF") {
                    break;
                }
                continue;
            }

            const parsed = parseNullSeparatedEnvironment(probe.stdout);
            if (Object.keys(parsed).length > 0) {
                return parsed;
            }
        } catch {
            break;
        }
    }

    // Fallback: capture env to a temp file (avoids pipes entirely).
    // Works in Electron's utilityProcess where spawn with pipes fails.
    try {
        const tmpFile = join(tmpdir(), `selene-env-${process.pid}-${Date.now()}.tmp`);
        for (const shellPath of getCandidateShells()) {
            try {
                execSync(`${shellPath} -ilc 'env -0 > "${tmpFile}"'`, {
                    stdio: "ignore",
                    timeout: SHELL_RESOLVE_TIMEOUT_MS,
                    env: bootstrapEnv,
                });
                const raw = fs.readFileSync(tmpFile, "utf8");
                try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
                const parsed = parseNullSeparatedEnvironment(raw);
                if (Object.keys(parsed).length > 0) {
                    return parsed;
                }
            } catch {
                try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
                continue;
            }
        }
    } catch {
        // All attempts failed
    }

    return {};
}

export function getResolvedShellEnvironment(): Record<string, string> {
    if (!shellEnvResolutionAttempted) {
        shellEnvResolutionAttempted = true;
        lastResolutionAttemptMs = Date.now();
        cachedShellEnv = resolveShellEnvironmentOnce();

        // If resolution returned empty (likely spawn failure due to EBADF/EMFILE),
        // allow retrying after a cooldown instead of permanently caching the failure.
        if (cachedShellEnv && Object.keys(cachedShellEnv).length === 0) {
            shellEnvResolutionAttempted = false;
            cachedShellEnv = null;
        }
    } else if (
        cachedShellEnv === null &&
        Date.now() - lastResolutionAttemptMs >= RETRY_INTERVAL_MS
    ) {
        // Retry: previous attempt failed and cooldown has elapsed.
        lastResolutionAttemptMs = Date.now();
        const result = resolveShellEnvironmentOnce();
        if (Object.keys(result).length > 0) {
            cachedShellEnv = result;
            shellEnvResolutionAttempted = true;
        }
    }

    return cachedShellEnv ?? {};
}

export function resetResolvedShellEnvironmentForTests(): void {
    cachedShellEnv = null;
    shellEnvResolutionAttempted = false;
}
