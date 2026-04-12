import type { FrameworkType } from "./project-detection";

export type DesignWorkspaceHooksPreset = "off" | "fast" | "strict";

export interface DesignWorkspaceConfig {
  postEditHooksPreset: DesignWorkspaceHooksPreset;
  postEditHooksEnabled: boolean;
  postEditTypecheckEnabled: boolean;
  postEditImportValidationEnabled: boolean;
  postEditPreviewEnabled: boolean;
  typecheckStrictMode: boolean;
  jsxValidationEnabled: boolean;
  sourceMode: "sandbox" | "project";
  projectRoot?: string;
  frameworkOverride?: FrameworkType;
  worktreeLocation: "inside-project" | "temp-dir";
  autoInstallProjectDeps: boolean;
  devServerTimeoutMs: number;
  maxDevServers: number;
  rendererTier: "compile-only" | "all";
  useProjectTsConfig: boolean;
  useProjectTailwindConfig: boolean;
}

export interface DesignWorkspaceValidationCheck {
  name: string;
  status: "pass" | "fail" | "skip";
  message?: string;
}

export interface DesignWorkspaceValidationResult {
  passed: boolean;
  preset: DesignWorkspaceHooksPreset;
  checks: DesignWorkspaceValidationCheck[];
  durationMs: number;
}

export type DesignWorkspaceCompilationIssueType =
  | "dependency"
  | "syntax"
  | "type"
  | "runtime"
  | "unknown";

export interface DesignWorkspaceSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface DesignWorkspaceCompilationIssue {
  type: DesignWorkspaceCompilationIssueType;
  message: string;
  location?: DesignWorkspaceSourceLocation;
  suggestion?: string;
}

export interface DesignWorkspaceDependencySummary {
  manifestPackages: string[];
  importedPackages: string[];
  checkedPackages: string[];
  missingManifestPackages: string[];
  missingImportedPackages: string[];
  missingPackages: string[];
}

export interface DesignWorkspaceAutoInstallSummary {
  attempted: boolean;
  success: boolean;
  packages: string[];
  packageNames: string[];
  error?: string;
}

export interface DesignWorkspaceDiagnostic {
  text: string;
  location?: DesignWorkspaceSourceLocation;
}

export interface DesignWorkspaceCompileReport {
  warnings: string[];
  diagnostics?: DesignWorkspaceDiagnostic[];
  errors: DesignWorkspaceCompilationIssue[];
  dependencyCheck: DesignWorkspaceDependencySummary;
  autoInstall?: DesignWorkspaceAutoInstallSummary;
  recovered: boolean;
  durationMs: number;
}

export const DEFAULT_DESIGN_WORKSPACE_CONFIG: DesignWorkspaceConfig = {
  postEditHooksPreset: "fast",
  postEditHooksEnabled: true,
  postEditTypecheckEnabled: false,
  postEditImportValidationEnabled: true,
  postEditPreviewEnabled: true,
  typecheckStrictMode: false,
  jsxValidationEnabled: true,
  sourceMode: "sandbox",
  worktreeLocation: "inside-project",
  autoInstallProjectDeps: true,
  devServerTimeoutMs: 30_000,
  maxDevServers: 3,
  rendererTier: "all",
  useProjectTsConfig: true,
  useProjectTailwindConfig: true,
};

function isPreset(value: unknown): value is DesignWorkspaceHooksPreset {
  return value === "off" || value === "fast" || value === "strict";
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeDesignWorkspaceConfig(
  value?: Partial<DesignWorkspaceConfig> | null,
): DesignWorkspaceConfig {
  const normalizedPreset = isPreset(value?.postEditHooksPreset)
    ? value!.postEditHooksPreset
    : DEFAULT_DESIGN_WORKSPACE_CONFIG.postEditHooksPreset;

  return {
    postEditHooksPreset: normalizedPreset,
    postEditHooksEnabled: readBoolean(
      value?.postEditHooksEnabled,
      normalizedPreset === "off"
        ? false
        : DEFAULT_DESIGN_WORKSPACE_CONFIG.postEditHooksEnabled,
    ),
    postEditTypecheckEnabled: readBoolean(
      value?.postEditTypecheckEnabled,
      normalizedPreset === "strict",
    ),
    postEditImportValidationEnabled: readBoolean(
      value?.postEditImportValidationEnabled,
      DEFAULT_DESIGN_WORKSPACE_CONFIG.postEditImportValidationEnabled,
    ),
    postEditPreviewEnabled: readBoolean(
      value?.postEditPreviewEnabled,
      DEFAULT_DESIGN_WORKSPACE_CONFIG.postEditPreviewEnabled,
    ),
    typecheckStrictMode: readBoolean(
      value?.typecheckStrictMode,
      normalizedPreset === "strict",
    ),
    jsxValidationEnabled: readBoolean(
      value?.jsxValidationEnabled,
      DEFAULT_DESIGN_WORKSPACE_CONFIG.jsxValidationEnabled,
    ),
    sourceMode: value?.sourceMode === "project" ? "project" : "sandbox",
    projectRoot: typeof value?.projectRoot === "string" ? value.projectRoot : undefined,
    frameworkOverride: value?.frameworkOverride,
    worktreeLocation: value?.worktreeLocation === "temp-dir" ? "temp-dir" : "inside-project",
    autoInstallProjectDeps: readBoolean(value?.autoInstallProjectDeps, true),
    devServerTimeoutMs: typeof value?.devServerTimeoutMs === "number" ? value.devServerTimeoutMs : 30_000,
    maxDevServers: typeof value?.maxDevServers === "number" ? value.maxDevServers : 3,
    rendererTier: value?.rendererTier === "compile-only" ? "compile-only" : "all",
    useProjectTsConfig: readBoolean(value?.useProjectTsConfig, true),
    useProjectTailwindConfig: readBoolean(value?.useProjectTailwindConfig, true),
  };
}

export function getDesignWorkspaceConfigFromSettingsRecord(
  settings: Record<string, unknown> | null | undefined,
): DesignWorkspaceConfig {
  return normalizeDesignWorkspaceConfig({
    postEditHooksPreset: isPreset(settings?.designPostEditHooksPreset)
      ? settings.designPostEditHooksPreset
      : undefined,
    postEditHooksEnabled:
      typeof settings?.designPostEditHooksEnabled === "boolean"
        ? settings.designPostEditHooksEnabled
        : undefined,
    postEditTypecheckEnabled:
      typeof settings?.designPostEditTypecheckEnabled === "boolean"
        ? settings.designPostEditTypecheckEnabled
        : undefined,
    postEditImportValidationEnabled:
      typeof settings?.designPostEditImportValidationEnabled === "boolean"
        ? settings.designPostEditImportValidationEnabled
        : undefined,
    postEditPreviewEnabled:
      typeof settings?.designPostEditPreviewEnabled === "boolean"
        ? settings.designPostEditPreviewEnabled
        : undefined,
    typecheckStrictMode:
      typeof settings?.designTypecheckStrictMode === "boolean"
        ? settings.designTypecheckStrictMode
        : undefined,
    jsxValidationEnabled:
      typeof settings?.designJsxValidationEnabled === "boolean"
        ? settings.designJsxValidationEnabled
        : undefined,
    sourceMode: settings?.designSourceMode === "project" ? "project" : undefined,
    worktreeLocation: settings?.designWorktreeLocation === "temp-dir" ? "temp-dir" : undefined,
    autoInstallProjectDeps: typeof settings?.designAutoInstallProjectDeps === "boolean" ? settings.designAutoInstallProjectDeps : undefined,
    devServerTimeoutMs: typeof settings?.designDevServerTimeoutMs === "number" ? settings.designDevServerTimeoutMs : undefined,
    maxDevServers: typeof settings?.designMaxDevServers === "number" ? settings.designMaxDevServers : undefined,
    useProjectTsConfig: typeof settings?.designUseProjectTsConfig === "boolean" ? settings.designUseProjectTsConfig : undefined,
    useProjectTailwindConfig: typeof settings?.designUseProjectTailwindConfig === "boolean" ? settings.designUseProjectTailwindConfig : undefined,
    rendererTier: settings?.designRendererTier === "compile-only" ? "compile-only" : undefined,
  });
}

export function toDesignWorkspaceSettingsPatch(
  patch: Partial<DesignWorkspaceConfig>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (patch.postEditHooksPreset !== undefined) {
    body.designPostEditHooksPreset = patch.postEditHooksPreset;
  }
  if (patch.postEditHooksEnabled !== undefined) {
    body.designPostEditHooksEnabled = patch.postEditHooksEnabled;
  }
  if (patch.postEditTypecheckEnabled !== undefined) {
    body.designPostEditTypecheckEnabled = patch.postEditTypecheckEnabled;
  }
  if (patch.postEditImportValidationEnabled !== undefined) {
    body.designPostEditImportValidationEnabled = patch.postEditImportValidationEnabled;
  }
  if (patch.postEditPreviewEnabled !== undefined) {
    body.designPostEditPreviewEnabled = patch.postEditPreviewEnabled;
  }
  if (patch.typecheckStrictMode !== undefined) {
    body.designTypecheckStrictMode = patch.typecheckStrictMode;
  }
  if (patch.jsxValidationEnabled !== undefined) {
    body.designJsxValidationEnabled = patch.jsxValidationEnabled;
  }
  if (patch.sourceMode !== undefined) body.designSourceMode = patch.sourceMode;
  if (patch.worktreeLocation !== undefined) body.designWorktreeLocation = patch.worktreeLocation;
  if (patch.autoInstallProjectDeps !== undefined) body.designAutoInstallProjectDeps = patch.autoInstallProjectDeps;
  if (patch.devServerTimeoutMs !== undefined) body.designDevServerTimeoutMs = patch.devServerTimeoutMs;
  if (patch.maxDevServers !== undefined) body.designMaxDevServers = patch.maxDevServers;
  if (patch.useProjectTsConfig !== undefined) body.designUseProjectTsConfig = patch.useProjectTsConfig;
  if (patch.useProjectTailwindConfig !== undefined) body.designUseProjectTailwindConfig = patch.useProjectTailwindConfig;
  if (patch.rendererTier !== undefined) body.designRendererTier = patch.rendererTier;

  return body;
}
