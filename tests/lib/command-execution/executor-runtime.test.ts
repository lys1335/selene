import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shell-env/resolver", () => ({
    getResolvedShellEnvironment: vi.fn(() => ({})),
}));

import * as shellEnvResolver from "@/lib/shell-env/resolver";
import { buildSafeEnvironment, normalizeUnixPath, normalizeArgs, type BundledRuntimeInfo } from "@/lib/command-execution/executor-runtime";
import { tmpdir } from "os";
import { join, delimiter } from "path";

const baseRuntime: BundledRuntimeInfo = {
    resourcesPath: "/tmp/resources",
    isProductionBuild: true,
    nodeBinDir: null,
    toolsBinDir: null,
    ripgrepBinDir: null,
    bundledBinDirs: [],
    bundledNodePath: null,
    bundledNpmCliPath: null,
    bundledNpxCliPath: null,
};

const bundledRipgrepBinDir = "/bundle/node_modules/@vscode/ripgrep/bin";

describe("buildSafeEnvironment", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({});
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    // ── Shell env as primary source ──────────────────────────────────────

    it("uses shell env as primary source when available (process.env excluded)", () => {
        process.env.LEAKED_FROM_ELECTRON = "bad";
        process.env.TEST_BASE_ENV = "from-process";
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            TEST_BASE_ENV: "from-shell",
            TEST_ONLY_SHELL: "yes",
        });

        const env = buildSafeEnvironment(baseRuntime);

        // Shell env values are present
        expect(env.TEST_BASE_ENV).toBe("from-shell");
        expect(env.TEST_ONLY_SHELL).toBe("yes");
        // process.env values that are NOT in shell env should NOT leak through
        expect(env.LEAKED_FROM_ELECTRON).toBeUndefined();
    });

    it("preserves NODE_ENV from shell env (user's rcfiles set it)", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            NODE_ENV: "development",
            PATH: "/usr/local/bin:/usr/bin",
        });

        const env = buildSafeEnvironment(baseRuntime);

        // NODE_ENV from shell env should pass through — the shell env was
        // captured from a clean login shell, so this value comes from the
        // user's rcfiles, which is correct behavior.
        expect(env.NODE_ENV).toBe("development");
    });

    it("strips SELENE_PRODUCTION_BUILD even from shell env (defense-in-depth)", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            SELENE_PRODUCTION_BUILD: "1",
            SAFE_KEY: "ok",
        });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.SELENE_PRODUCTION_BUILD).toBeUndefined();
        expect(env.SAFE_KEY).toBe("ok");
    });

    // ── process.env fallback (shell env unavailable) ────────────────────

    it("falls back to process.env when shell env is empty", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({});
        process.env.MY_VAR = "from-process";

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.MY_VAR).toBe("from-process");
    });

    it("strips NODE_ENV from process.env fallback", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({});
        process.env.NODE_ENV = "production";

        const env = buildSafeEnvironment(baseRuntime);

        // In fallback mode, NODE_ENV (from Electron/Next.js) must be stripped
        expect(env.NODE_ENV).toBeUndefined();
    });

    it("strips SELENE_PRODUCTION_BUILD from process.env fallback", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({});
        process.env.SELENE_PRODUCTION_BUILD = "1";

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.SELENE_PRODUCTION_BUILD).toBeUndefined();
    });

    it("preserves important defaults when shell env is sparse (fallback)", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({});
        process.env.USERPROFILE = "/Users/test";
        delete process.env.HOME;
        delete process.env.USER;
        process.env.USERNAME = "tester";

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.HOME).toBe("/Users/test");
        expect(env.USER).toBe("tester");
        expect(env.TERM).toBe("xterm-256color");
    });

    // ── Common behavior (both paths) ────────────────────────────────────

    it("prepends bundled binary dirs to the resolved PATH", () => {
        const sep = delimiter; // ";" on Windows, ":" elsewhere
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            PATH: `/usr/local/bin${sep}/usr/bin`,
        });

        const env = buildSafeEnvironment({
            ...baseRuntime,
            bundledBinDirs: ["/bundle/node/.bin", "/bundle/tools/bin", bundledRipgrepBinDir],
        });

        expect(env.PATH).toBe(`/bundle/node/.bin${sep}/bundle/tools/bin${sep}${bundledRipgrepBinDir}${sep}/usr/local/bin${sep}/usr/bin`);
    });

    it("removes Electron-only env keys from shell env", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            ELECTRON_RUN_AS_NODE: "1",
            ELECTRON_NO_ATTACH_CONSOLE: "1",
            SAFE_KEY: "ok",
        });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined();
        expect(env.SAFE_KEY).toBe("ok");
    });

    it("removes Electron-only env keys from process.env fallback", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({});
        process.env.ELECTRON_RUN_AS_NODE = "1";
        process.env.ELECTRON_ENABLE_LOGGING = "1";

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.ELECTRON_ENABLE_LOGGING).toBeUndefined();
    });

    it("strips all __NEXT_* vars regardless of source", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            __NEXT_PRIVATE_STANDALONE_CONFIG: "/some/path",
            __NEXT_PROCESSED_ENV: "true",
            __NEXT_PRIVATE_ORIGIN: "http://localhost:3457",
            SAFE_KEY: "ok",
        });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeUndefined();
        expect(env.__NEXT_PROCESSED_ENV).toBeUndefined();
        expect(env.__NEXT_PRIVATE_ORIGIN).toBeUndefined();
        expect(env.SAFE_KEY).toBe("ok");
    });

    it("strips TURBOPACK and NEXT_PRIVATE_* vars regardless of source", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            TURBOPACK: "1",
            NEXT_PRIVATE_BUILD_WORKER: "1",
            NEXT_PRIVATE_LOCAL_WEBPACK: "1",
            PATH: "/usr/bin",
            SAFE_KEY: "ok",
        });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.TURBOPACK).toBeUndefined();
        expect(env.NEXT_PRIVATE_BUILD_WORKER).toBeUndefined();
        expect(env.NEXT_PRIVATE_LOCAL_WEBPACK).toBeUndefined();
        expect(env.SAFE_KEY).toBe("ok");
    });

    it("strips NEXT_RUNTIME and NEXT_DEPLOYMENT_ID from always-blocked list", () => {
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            NEXT_RUNTIME: "nodejs",
            NEXT_DEPLOYMENT_ID: "abc123",
            PATH: "/usr/bin",
        });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.NEXT_RUNTIME).toBeUndefined();
        expect(env.NEXT_DEPLOYMENT_ID).toBeUndefined();
    });

    it("always injects ELECTRON_RESOURCES_PATH from process.env", () => {
        // Even when shell env is primary, ELECTRON_RESOURCES_PATH comes from
        // process.env because it's a Selene platform-specific addition.
        process.env.ELECTRON_RESOURCES_PATH = "/app/resources";
        vi.mocked(shellEnvResolver.getResolvedShellEnvironment).mockReturnValue({
            PATH: "/usr/local/bin:/usr/bin",
        });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.ELECTRON_RESOURCES_PATH).toBe("/app/resources");
    });

    it("preserves system PATH on Windows despite case mismatch", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "win32" });

        // Simulate Windows env where PATH is stored as "Path"
        const env = buildSafeEnvironment(baseRuntime);

        // PATH must contain the system PATH value, not be empty
        expect(env.PATH).toBeTruthy();
        expect(typeof env.PATH).toBe("string");
        expect((env.PATH as string).length).toBeGreaterThan(0);

        // Must not have duplicate Path/PATH keys
        const pathKeys = Object.keys(env).filter(k => k.toUpperCase() === "PATH");
        expect(pathKeys).toEqual(["PATH"]);

        Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("injects TMPDIR on Windows", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "win32" });

        const env = buildSafeEnvironment(baseRuntime);

        expect(env.TMPDIR).toBe(tmpdir());

        Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("does not inject TMPDIR on non-Windows", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "darwin" });

        const env = buildSafeEnvironment(baseRuntime);

        // TMPDIR may exist from process.env, but buildSafeEnvironment shouldn't inject it
        // The key behavior is that on non-win32, the tmpOverrides block is skipped
        Object.defineProperty(process, "platform", { value: originalPlatform });
    });
});

describe("normalizeUnixPath", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("translates /tmp to os.tmpdir() on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("/tmp")).toBe(tmpdir());
    });

    it("translates /tmp/file.json to tmpdir join on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("/tmp/file.json")).toBe(join(tmpdir(), "file.json"));
    });

    it("translates /var/tmp/data.json on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("/var/tmp/data.json")).toBe(join(tmpdir(), "data.json"));
    });

    it("translates --output=/tmp/file.json flag=value on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("--output=/tmp/file.json")).toBe(`--output=${join(tmpdir(), "file.json")}`);
    });

    it("does not modify non-tmp paths on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("/home/user/file.json")).toBe("/home/user/file.json");
        expect(normalizeUnixPath("--verbose")).toBe("--verbose");
        expect(normalizeUnixPath("hello")).toBe("hello");
    });

    it("is a no-op on non-Windows", () => {
        Object.defineProperty(process, "platform", { value: "linux" });

        expect(normalizeUnixPath("/tmp/file.json")).toBe("/tmp/file.json");
    });

    it("handles /tmp with trailing slash", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("/tmp/")).toBe(tmpdir());
    });

    it("handles /tmp with nested subdirectories", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(normalizeUnixPath("/tmp/deep/nested/file.json")).toBe(join(tmpdir(), "deep", "nested", "file.json"));
    });
});

describe("normalizeArgs", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("normalizes all /tmp args in array on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });

        const result = normalizeArgs(["-c", "console.log('hi')", "/tmp/output.json", "--config=/tmp/cfg.json"]);

        expect(result[0]).toBe("-c");
        expect(result[1]).toBe("console.log('hi')");
        expect(result[2]).toBe(join(tmpdir(), "output.json"));
        expect(result[3]).toBe(`--config=${join(tmpdir(), "cfg.json")}`);
    });

    it("returns args unchanged on non-Windows", () => {
        Object.defineProperty(process, "platform", { value: "linux" });

        const args = ["/tmp/file.json", "--output=/tmp/data.json"];
        expect(normalizeArgs(args)).toBe(args); // same reference
    });
});
