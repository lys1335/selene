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
    "NEXT_RUNTIME",
    "NEXT_DEPLOYMENT_ID",
    "PORT",
]);

/**
 * Prefix patterns stripped during shell-env capture. Any env var starting with
 * these belongs to the running Next.js host process and must not be inherited
 * by user-facing child commands.
 */
const BLOCKED_ENV_PREFIXES = ["__NEXT_"];

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

function resolveShellEnvironmentOnce(): Record<string, string> {
    if (process.platform === "win32") {
        return {};
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
