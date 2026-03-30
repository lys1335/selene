import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";

const shellEnvMocks = vi.hoisted(() => ({
  getResolvedShellEnvironment: vi.fn(() => ({})),
}));

vi.mock("@/lib/shell-env/resolver", () => ({
  getResolvedShellEnvironment: shellEnvMocks.getResolvedShellEnvironment,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

import {
  buildEnvironmentForTarget,
  initializeProcessEnvironment,
  resolveBaseEnvironment,
  sanitizeEnvironment,
} from "@/lib/process-env/policy";

const originalEnv = process.env;
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
}

describe("process-env policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    setPlatform("darwin");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(shellEnvMocks.getResolvedShellEnvironment).mockReturnValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
    setPlatform(originalPlatform);
  });

  describe("resolveBaseEnvironment", () => {
    it("prefers shell env when available", () => {
      const result = resolveBaseEnvironment({
        processEnv: { FROM_PROCESS: "no" },
        shellEnv: { FROM_SHELL: "yes" },
      });

      expect(result.source).toBe("shell");
      expect(result.shellEnvAvailable).toBe(true);
      expect(result.env).toEqual({ FROM_SHELL: "yes" });
    });

    it("falls back to process env when shell env is empty", () => {
      const result = resolveBaseEnvironment({
        processEnv: { FROM_PROCESS: "yes" },
        shellEnv: {},
      });

      expect(result.source).toBe("process");
      expect(result.shellEnvAvailable).toBe(false);
      expect(result.env).toEqual({ FROM_PROCESS: "yes" });
    });
  });

  describe("sanitizeEnvironment", () => {
    it("removes always-blocked keys, prefixes, and caller extras", () => {
      const sanitized = sanitizeEnvironment(
        {
          SAFE_KEY: "ok",
          PORT: "3000",
          NEXT_RUNTIME: "nodejs",
          __NEXT_PRIVATE_ORIGIN: "http://localhost:3000",
          ELECTRON_RUN_AS_NODE: "1",
          CUSTOM_BLOCK: "remove-me",
        },
        ["CUSTOM_BLOCK"],
      );

      expect(sanitized.SAFE_KEY).toBe("ok");
      expect(sanitized.PORT).toBeUndefined();
      expect(sanitized.NEXT_RUNTIME).toBeUndefined();
      expect(sanitized.__NEXT_PRIVATE_ORIGIN).toBeUndefined();
      expect(sanitized.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(sanitized.CUSTOM_BLOCK).toBeUndefined();
    });
  });

  describe("buildEnvironmentForTarget (execute-command)", () => {
    it("uses shell env as the primary source and excludes unrelated process vars", () => {
      const env = buildEnvironmentForTarget({
        target: "execute-command",
        processEnv: {
          LEAKED_FROM_PROCESS: "bad",
          ELECTRON_RESOURCES_PATH: "/resources",
        },
        shellEnv: {
          SAFE_KEY: "shell",
          PATH: "/usr/local/bin:/usr/bin",
        },
        runtime: {
          resourcesPath: "/bundle/resources",
          bundledBinDirs: ["/bundle/bin"],
        },
      }).env;

      expect(env.SAFE_KEY).toBe("shell");
      expect(env.LEAKED_FROM_PROCESS).toBeUndefined();
      expect(env.PATH).toBe("/bundle/bin:/usr/local/bin:/usr/bin");
      expect(env.ELECTRON_RESOURCES_PATH).toBe("/resources");
    });

    it("preserves host PATH entries after bundled bins in packaged mode", () => {
      const env = buildEnvironmentForTarget({
        target: "execute-command",
        processEnv: {
          PATH: "/usr/local/bin:/usr/bin:/opt/custom/bin",
          ELECTRON_RESOURCES_PATH: "/resources",
        },
        shellEnv: {
          PATH: "/bundle-shell/bin:/usr/local/bin",
        },
        runtime: {
          resourcesPath: "/bundle/resources",
          bundledBinDirs: ["/bundle/bin", "/bundle/tools/bin"],
        },
      }).env;

      expect(env.PATH).toBe("/bundle/bin:/bundle/tools/bin:/bundle-shell/bin:/usr/local/bin:/usr/bin:/opt/custom/bin");
    });

    it("falls back to process env and strips NODE_ENV when shell env is unavailable", () => {
      const env = buildEnvironmentForTarget({
        target: "execute-command",
        processEnv: {
          NODE_ENV: "production",
          USERPROFILE: "/Users/tester",
          USERNAME: "tester",
          PATH: "/usr/bin",
        },
        shellEnv: {},
      }).env;

      expect(env.NODE_ENV).toBeUndefined();
      expect(env.HOME).toBe("/Users/tester");
      expect(env.USER).toBe("tester");
      expect(env.TERM).toBe("xterm-256color");
    });

    it("preserves Git Bash and mingw PATH entries for Windows execute-command while still cleaning MSYS vars", () => {
      setPlatform("win32");
      process.env.SystemRoot = "C:\\WINDOWS";

      const env = buildEnvironmentForTarget({
        target: "execute-command",
        processEnv: {
          PATH: "C:\\Program Files\\Git\\bin;C:\\msys64\\mingw64\\bin;C:\\Tools\\bin",
          Path: "C:\\WINDOWS\\system32",
          MSYSTEM: "MINGW64",
          SHELL: "/bin/bash.exe",
        },
        shellEnv: {},
      }).env;

      expect(env.MSYSTEM).toBeUndefined();
      expect(env.SHELL).toBeUndefined();
      expect(env.PATH).toContain("C:\\Program Files\\Git\\bin");
      expect(env.PATH).toContain("C:\\msys64\\mingw64\\bin");
      expect(env.PATH).toContain("C:\\Tools\\bin");
      expect(env.PATH).toContain("C:\\WINDOWS\\system32");
      expect(env.TMPDIR).toBeTruthy();
      expect(Object.keys(env).filter((key) => key.toUpperCase() === "PATH")).toEqual(["PATH"]);
    });
  });

  describe("buildEnvironmentForTarget (claude-sdk)", () => {
    it("strips nested-session and app auth keys", () => {
      setPlatform("darwin");

      const env = buildEnvironmentForTarget({
        target: "claude-sdk",
        isProduction: false,
        processEnv: {
          CLAUDECODE: "1",
          ANTHROPIC_API_KEY: "abc",
          SAFE_KEY: "ok",
          PATH: "/usr/bin",
        },
        shellEnv: {},
      }).env;

      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.SAFE_KEY).toBe("ok");
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });

    it("uses shell PATH in production mode when available", () => {
      setPlatform("darwin");

      const result = buildEnvironmentForTarget({
        target: "claude-sdk",
        isProduction: true,
        processEnv: {
          PATH: "/usr/bin:/bin",
        },
        shellEnv: {
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        },
      });

      expect(result.source).toBe("shell");
      expect(result.env.PATH).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
      expect(result.env.ELECTRON_RUN_AS_NODE).toBe("1");
    });

    it("preserves Windows Git Bash compatibility while stripping MSYS markers", () => {
      setPlatform("win32");
      process.env.SystemRoot = "C:\\WINDOWS";

      const env = buildEnvironmentForTarget({
        target: "claude-sdk",
        isProduction: true,
        processEnv: {
          PATH: "C:\\Program Files\\Git\\bin;C:\\Tools\\bin",
          MSYSTEM: "MINGW64",
          CLAUDECODE: "1",
        },
        shellEnv: {},
      }).env;

      expect(env.MSYSTEM).toBeUndefined();
      expect(env.PATH).toContain("C:\\Program Files\\Git\\bin");
      expect(env.MSYS2_PATH_TYPE).toBe("inherit");
      expect(env.MSYS_NO_PATHCONV).toBe("1");
      expect(env.CHERE_INVOKING).toBe("1");
      expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    });
  });

  describe("initializeProcessEnvironment", () => {
    it("normalizes the live Windows process env without filtering Git Bash paths by default", () => {
      setPlatform("win32");
      process.env = {
        ...originalEnv,
        PATH: "C:\\Program Files\\Git\\bin;C:\\Tools\\bin",
        Path: "C:\\WINDOWS\\system32",
        MSYSTEM: "MINGW64",
        SystemRoot: "C:\\WINDOWS",
      };

      initializeProcessEnvironment({ processEnv: process.env });

      expect(process.env.MSYSTEM).toBeUndefined();
      expect(process.env.PATH).toContain("C:\\Program Files\\Git\\bin");
      expect(process.env.PATH).toContain("C:\\WINDOWS\\system32");
      expect(process.env.ComSpec).toBe("C:\\WINDOWS\\system32\\cmd.exe");
      expect(Object.keys(process.env).filter((key) => key.toUpperCase() === "PATH")).toEqual(["PATH"]);
    });

    it("can filter Git Bash paths when explicitly requested", () => {
      setPlatform("win32");
      process.env = {
        ...originalEnv,
        PATH: "C:\\Program Files\\Git\\bin;C:\\Tools\\bin",
        SystemRoot: "C:\\WINDOWS",
      };

      initializeProcessEnvironment({
        processEnv: process.env,
        filterGitBashPath: true,
      });

      expect(process.env.PATH).not.toContain("Git\\bin");
      expect(process.env.PATH).toContain("C:\\Tools\\bin");
    });
  });
});
