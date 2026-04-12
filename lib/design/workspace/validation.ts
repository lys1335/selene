import * as esbuild from "esbuild";
import ts from "typescript";
import { existsSync } from "fs";
import { join, resolve } from "path";
import {
  type DesignWorkspaceConfig,
  type DesignWorkspaceValidationCheck,
  type DesignWorkspaceValidationResult,
} from "./config";
import { validateWorkspaceDependencies, validateProjectDependencies, type DependencyValidationResult } from "./dependencies";
import { buildTailwindPreviewWithMetadata } from "./compiler";
import { getProjectRoot } from "../../utils/project-root";
import { SANDBOX_NODE_MODULES } from "../libraries";
import type { ProjectContext } from "./types";

const PROJECT_ROOT = getProjectRoot();
const VIRTUAL_FILE = resolve(PROJECT_ROOT, "__selene_design_workspace_validation__.tsx");

interface RunPostEditValidationOptions {
  dependencyCheck?: DependencyValidationResult;
  previewBuildPassed?: boolean;
  projectContext?: ProjectContext;
}

function buildCheck(
  name: string,
  status: DesignWorkspaceValidationCheck["status"],
  message?: string,
): DesignWorkspaceValidationCheck {
  return { name, status, message };
}

function formatTypeScriptDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function runTypeScriptValidation(
  componentCode: string,
  config: DesignWorkspaceConfig,
): string[] {
  const options: ts.CompilerOptions = {
    allowJs: false,
    baseUrl: PROJECT_ROOT,
    paths: { "*": ["*"] },
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    reactNamespace: "React",
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: config.typecheckStrictMode,
    target: ts.ScriptTarget.ES2020,
    typeRoots: [
      resolve(PROJECT_ROOT, "node_modules/@types"),
      resolve(SANDBOX_NODE_MODULES, "@types"),
    ],
    types: ["react", "react-dom"],
  };

  const host = ts.createCompilerHost(options, true);
  host.getCurrentDirectory = () => PROJECT_ROOT;
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);

  // Add sandbox node_modules to module resolution paths
  host.getDirectories = (path: string) => {
    try {
      return ts.sys.getDirectories(path);
    } catch {
      return [];
    }
  };

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === VIRTUAL_FILE) {
      return ts.createSourceFile(fileName, componentCode, languageVersion, true, ts.ScriptKind.TSX);
    }
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  host.readFile = (fileName) => {
    if (fileName === VIRTUAL_FILE) {
      return componentCode;
    }
    return readFile(fileName);
  };

  host.fileExists = (fileName) => {
    if (fileName === VIRTUAL_FILE) {
      return true;
    }
    return fileExists(fileName);
  };

  const program = ts.createProgram([VIRTUAL_FILE], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map(formatTypeScriptDiagnostic)
    .filter(Boolean);
}

export async function runPostEditValidation(
  componentCode: string,
  config: DesignWorkspaceConfig,
  options: RunPostEditValidationOptions = {},
): Promise<DesignWorkspaceValidationResult> {
  const startedAt = Date.now();
  const checks: DesignWorkspaceValidationCheck[] = [];

  if (!config.postEditHooksEnabled || config.postEditHooksPreset === "off") {
    return {
      passed: true,
      preset: config.postEditHooksPreset,
      checks: [buildCheck("post-edit hooks", "skip", "Workspace hooks are disabled.")],
      durationMs: 0,
    };
  }

  // In project mode, use project dependency validation as the authoritative check
  // instead of sandbox validation (which would produce false failures).
  const isProjectMode = !!options.projectContext?.worktreePath;
  let dependencyCheck: DependencyValidationResult;

  if (isProjectMode) {
    const projectNodeModules = join(options.projectContext!.worktreePath!, "node_modules");
    dependencyCheck = options.dependencyCheck
      ?? await validateProjectDependencies(componentCode, projectNodeModules);
  } else {
    dependencyCheck = options.dependencyCheck ?? await validateWorkspaceDependencies(componentCode);
  }

  if (config.postEditImportValidationEnabled) {
    if (dependencyCheck.missingPackages.length > 0) {
      const context = isProjectMode ? " (project)" : "";
      checks.push(
        buildCheck(
          "import resolution",
          "fail",
          `Missing packages${context}: ${dependencyCheck.missingPackages.join(", ")}`,
        ),
      );
    } else {
      const detail = isProjectMode
        ? "All packages resolve (including project dependencies)."
        : "All referenced workspace packages resolve.";
      checks.push(buildCheck("import resolution", "pass", detail));
    }
  } else {
    checks.push(buildCheck("import resolution", "skip", "Import validation is disabled."));
  }

  if (config.jsxValidationEnabled) {
    try {
      await esbuild.transform(componentCode, {
        jsx: "automatic",
        jsxImportSource: "react",
        loader: "tsx",
        logLevel: "silent",
      });
      checks.push(buildCheck("JSX validation", "pass", "TSX syntax is valid."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid TSX syntax.";
      checks.push(buildCheck("JSX validation", "fail", message));
    }
  } else {
    checks.push(buildCheck("JSX validation", "skip", "JSX validation is disabled."));
  }

  if (config.postEditTypecheckEnabled) {
    const diagnostics = runTypeScriptValidation(componentCode, config);
    if (diagnostics.length > 0) {
      const summary = diagnostics.length === 1
        ? diagnostics[0]
        : `${diagnostics[0]} (+${diagnostics.length - 1} more)`;
      checks.push(buildCheck("TypeScript typecheck", "fail", summary));
    } else {
      checks.push(
        buildCheck(
          "TypeScript typecheck",
          "pass",
          config.typecheckStrictMode ? "Strict mode passed." : "Typecheck passed.",
        ),
      );
    }
  } else {
    checks.push(buildCheck("TypeScript typecheck", "skip", "Typechecking is disabled."));
  }

  if (config.postEditPreviewEnabled && config.postEditHooksPreset === "strict") {
    if (options.previewBuildPassed) {
      checks.push(buildCheck("preview compilation", "pass", "Compiled preview succeeded."));
    } else {
      try {
        await buildTailwindPreviewWithMetadata(componentCode, "Validation Preview", {
          autoInstallMissingDependencies: false,
          source: "design-workspace-validation",
        });
        checks.push(buildCheck("preview compilation", "pass", "Compiled preview succeeded."));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Preview compilation failed.";
        checks.push(buildCheck("preview compilation", "fail", message));
      }
    }
  } else if (!config.postEditPreviewEnabled) {
    checks.push(buildCheck("preview compilation", "skip", "Preview compilation is disabled."));
  }

  return {
    passed: checks.every((check) => check.status !== "fail"),
    preset: config.postEditHooksPreset,
    checks,
    durationMs: Date.now() - startedAt,
  };
}
