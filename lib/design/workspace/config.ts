export type DesignWorkspaceHooksPreset = "off" | "fast" | "strict";

export interface DesignWorkspaceConfig {
  postEditHooksPreset: DesignWorkspaceHooksPreset;
  postEditHooksEnabled: boolean;
  postEditTypecheckEnabled: boolean;
  postEditImportValidationEnabled: boolean;
  postEditPreviewEnabled: boolean;
  typecheckStrictMode: boolean;
  jsxValidationEnabled: boolean;
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

  return body;
}
