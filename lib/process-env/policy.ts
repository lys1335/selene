import { tmpdir } from "os";
import { delimiter } from "path";
import { getResolvedShellEnvironment } from "@/lib/shell-env/resolver";
import { normalizeWindowsEnvironment } from "@/lib/utils/windows-env";

const ALWAYS_BLOCKED_ENV_KEYS = new Set([
  "SELENE_PRODUCTION_BUILD",
  "TURBOPACK",
  "NEXT_RUNTIME",
  "NEXT_DEPLOYMENT_ID",
  "PORT",
]);

const PROCESS_ENV_FALLBACK_BLOCKED_KEYS = new Set([
  "NODE_ENV",
]);

const BLOCKED_ENV_PREFIXES = [
  "__NEXT_",
  "NEXT_PRIVATE_",
  "ELECTRON_",
  "CHROME_",
];

const CLAUDE_SDK_BLOCKED_KEYS = new Set([
  "CLAUDECODE",
  "ANTHROPIC_API_KEY",
  "NODE_ENV",
]);

export type EnvironmentTarget = "execute-command" | "claude-sdk";
export type BaseEnvironmentSource = "shell" | "process";

export interface BundledPathRuntime {
  resourcesPath?: string | null;
  bundledBinDirs?: string[];
}

export interface ResolveBaseEnvironmentOptions {
  preferShellEnvironment?: boolean;
  processEnv?: Record<string, string | undefined>;
  shellEnv?: Record<string, string>;
}

export interface ResolvedBaseEnvironment {
  env: Record<string, string | undefined>;
  source: BaseEnvironmentSource;
  shellEnvAvailable: boolean;
}

export interface BuildEnvironmentForTargetOptions {
  target: EnvironmentTarget;
  isProduction?: boolean;
  processEnv?: Record<string, string | undefined>;
  shellEnv?: Record<string, string>;
  runtime?: BundledPathRuntime;
}

export interface BuildEnvironmentForTargetResult {
  env: Record<string, string | undefined>;
  source: BaseEnvironmentSource;
  shellEnvAvailable: boolean;
}

export interface InitializeProcessEnvironmentOptions {
  processEnv?: NodeJS.ProcessEnv;
  filterGitBashPath?: boolean;
  ensureComSpec?: boolean;
  ensureSystemPaths?: boolean;
}

export function sanitizeEnvironment(
  env: Record<string, string | undefined>,
  extraBlockedKeys?: Iterable<string>,
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

export function resolveBaseEnvironment(
  options: ResolveBaseEnvironmentOptions = {},
): ResolvedBaseEnvironment {
  const processEnv = options.processEnv ?? process.env;
  const preferShellEnvironment = options.preferShellEnvironment ?? true;
  const shellEnv = options.shellEnv ?? (preferShellEnvironment ? getResolvedShellEnvironment() : {});
  const shellEnvAvailable = Object.keys(shellEnv).length > 0;

  if (preferShellEnvironment && shellEnvAvailable) {
    return {
      env: { ...shellEnv },
      source: "shell",
      shellEnvAvailable,
    };
  }

  return {
    env: { ...processEnv },
    source: "process",
    shellEnvAvailable,
  };
}

export function buildEnvironmentForTarget(
  options: BuildEnvironmentForTargetOptions,
): BuildEnvironmentForTargetResult {
  switch (options.target) {
    case "execute-command":
      return buildExecuteCommandEnvironment(options);
    case "claude-sdk":
      return buildClaudeSdkEnvironment(options);
    default: {
      const exhaustiveTarget: never = options.target;
      throw new Error(`Unsupported environment target: ${exhaustiveTarget}`);
    }
  }
}

export function initializeProcessEnvironment(
  options: InitializeProcessEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const targetEnv = options.processEnv ?? process.env;
  if (process.platform !== "win32") return targetEnv;

  const normalized = normalizeWindowsEnvironment(
    targetEnv as Record<string, string | undefined>,
    {
      filterGitBashPath: options.filterGitBashPath ?? false,
      ensureComSpec: options.ensureComSpec ?? true,
      ensureSystemPaths: options.ensureSystemPaths ?? true,
      pathKey: "PATH",
    },
  );

  for (const key of Object.keys(targetEnv)) {
    if (!(key in normalized)) {
      delete targetEnv[key];
    }
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      delete targetEnv[key];
      continue;
    }
    targetEnv[key] = value ?? undefined;
  }

  return targetEnv;
}

function buildExecuteCommandEnvironment(
  options: BuildEnvironmentForTargetOptions,
): BuildEnvironmentForTargetResult {
  const processEnv = options.processEnv ?? process.env;
  const runtime = options.runtime ?? {};
  const base = resolveBaseEnvironment({
    preferShellEnvironment: true,
    processEnv,
    shellEnv: options.shellEnv,
  });

  const extraBlockedKeys = base.source === "process"
    ? PROCESS_ENV_FALLBACK_BLOCKED_KEYS
    : undefined;

  let env = sanitizeEnvironment({ ...base.env }, extraBlockedKeys);
  const currentPath = getPathValue(env);

  if (process.platform === "win32") {
    env = normalizeWindowsEnvironment(env, {
      filterGitBashPath: false,
      ensureComSpec: true,
      ensureSystemPaths: true,
      pathKey: "PATH",
    });
  } else {
    delete env.Path;
    env.PATH = currentPath;
  }

  env.PATH = prependBundledPaths(env.PATH || "", runtime.bundledBinDirs ?? []);
  env.TERM = env.TERM && env.TERM !== "dumb" ? env.TERM : "xterm-256color";
  env.HOME = env.HOME || env.USERPROFILE;
  env.USER = env.USER || env.USERNAME;

  const resourcesPath = processEnv.ELECTRON_RESOURCES_PATH || runtime.resourcesPath || undefined;
  if (resourcesPath) {
    env.ELECTRON_RESOURCES_PATH = resourcesPath;
  }

  if (process.platform === "win32") {
    env.TMPDIR = tmpdir();
  }

  return {
    env,
    source: base.source,
    shellEnvAvailable: base.shellEnvAvailable,
  };
}

function buildClaudeSdkEnvironment(
  options: BuildEnvironmentForTargetOptions,
): BuildEnvironmentForTargetResult {
  const processEnv = options.processEnv ?? process.env;
  const isProduction = Boolean(options.isProduction);
  const base = resolveBaseEnvironment({
    preferShellEnvironment: isProduction,
    processEnv,
    shellEnv: options.shellEnv,
  });

  let env = sanitizeEnvironment({ ...processEnv }, CLAUDE_SDK_BLOCKED_KEYS);

  if (process.platform === "win32") {
    env = normalizeWindowsEnvironment(env, {
      filterGitBashPath: false,
      ensureComSpec: true,
      ensureSystemPaths: true,
      pathKey: "PATH",
    });
  } else {
    const currentPath = getPathValue(env);
    delete env.Path;
    env.PATH = currentPath;
  }

  const shellPath = isProduction && base.source === "shell"
    ? getPathValue(base.env)
    : "";
  if (shellPath) {
    env.PATH = normalizeSdkPath(shellPath);
  }

  if (isProduction) {
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }

  if (process.platform === "win32") {
    env.MSYS2_PATH_TYPE = "inherit";
    env.MSYS_NO_PATHCONV = "1";
    env.CHERE_INVOKING = "1";
  }

  return {
    env,
    source: base.source,
    shellEnvAvailable: base.shellEnvAvailable,
  };
}

function normalizeSdkPath(pathValue: string): string {
  if (process.platform !== "win32") return pathValue;
  const normalized = normalizeWindowsEnvironment({ PATH: pathValue }, {
    filterGitBashPath: false,
    ensureComSpec: false,
    ensureSystemPaths: true,
    pathKey: "PATH",
  });
  return normalized.PATH || "";
}

function getPathValue(env: Record<string, string | undefined>): string {
  return env.PATH || env.Path || "";
}

function prependBundledPaths(pathValue: string, bundledBinDirs: string[]): string {
  if (bundledBinDirs.length === 0) return pathValue;
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  if (!pathValue) return bundledBinDirs.join(pathSeparator);
  return `${bundledBinDirs.join(pathSeparator)}${pathSeparator}${pathValue}`;
}
