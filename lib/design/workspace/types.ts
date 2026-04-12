import type {
  DesignWorkspaceConfig,
  DesignWorkspaceCompileReport,
  DesignWorkspaceValidationResult,
} from "./config";
import type { DesignWorkspaceHistory } from "./edit-history";
import type { DetectedFramework, FrameworkType, ProjectEntry, ProjectStructure } from "./project-detection";

// ---------------------------------------------------------------------------
// Project-native types
// ---------------------------------------------------------------------------

export type { DetectedFramework, FrameworkType, ProjectEntry, ProjectStructure };

export interface RendererInfo {
  type: "esbuild" | "vite" | "dev-server" | "php-server" | "static";
  port?: number;
  pid?: number;
  baseUrl?: string;
}

export interface ProjectContext {
  projectRoot: string;
  framework: DetectedFramework;
  worktreePath: string | null;
  worktreeBranch: string | null;
  syncFolderId: string | null;
  worktreeStatus: "none" | "creating" | "active" | "finalizing" | "cleaned";
  castFile: string | null;
  castMode: "page" | "component" | "route" | null;
  rendererInfo: RendererInfo | null;
  projectStructure: ProjectStructure | null;
}

export interface DesignComponent {
  id: string;
  name: string;
  code: string;
  mode: "tailwind";
  style: "apple-glass" | "default";
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSnapshot {
  id: string;
  componentId: string;
  code: string;
  label?: string;
  createdAt: string;
}

export interface DesignBreakpoint {
  name: string;
  width: number;
  height: number;
}

export const DESIGN_BREAKPOINTS: DesignBreakpoint[] = [
  { name: "responsive", width: 0, height: 0 },
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export type DesignWorkspaceStatus = "idle" | "generating" | "editing" | "exporting";

/** Element info captured by the in-iframe inspector and sent via postMessage. */
export interface InspectedElement {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  selector: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  computedStyles: {
    width: string;
    height: string;
    padding: string;
    margin: string;
    display: string;
    position: string;
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
  };
}

/** Serialisable session state that gets cached when switching sessions. */
export interface DesignWorkspaceSessionState {
  isOpen: boolean;
  status: DesignWorkspaceStatus;
  components: DesignComponent[];
  activeComponentId: string | null;
  snapshots: DesignSnapshot[];
  selectedBreakpoint: DesignBreakpoint;
  previewHtml: string;
  showCode: boolean;
  error: string | null;
  inspectorEnabled: boolean;
  selectedElement: InspectedElement | null;
  selectedElements: InspectedElement[];
  config: DesignWorkspaceConfig;
  lastValidation: DesignWorkspaceValidationResult | null;
  lastCompileReport: DesignWorkspaceCompileReport | null;
  history: DesignWorkspaceHistory | null;
  projectContext: ProjectContext | null;
}

export interface DesignWorkspaceState extends DesignWorkspaceSessionState {
  sessionId: string | null;
  open: () => void;
  close: () => void;
  setStatus: (status: DesignWorkspaceStatus) => void;
  addComponent: (component: DesignComponent) => void;
  updateComponent: (id: string, updates: Partial<DesignComponent>) => void;
  removeComponent: (id: string) => void;
  setActiveComponent: (id: string | null) => void;
  setPreviewHtml: (html: string) => void;
  setBreakpoint: (breakpoint: DesignBreakpoint) => void;
  toggleCode: () => void;
  toggleInspector: () => void;
  setSelectedElement: (el: InspectedElement | null) => void;
  setSelectedElements: (elements: InspectedElement[]) => void;
  toggleSelectedElement: (el: InspectedElement) => void;
  removeSelectedElement: (selector: string) => void;
  clearSelectedElements: () => void;
  takeSnapshot: (label?: string, id?: string) => void;
  restoreSnapshot: (snapshotId: string) => void;
  clearError: () => void;
  setError: (error: string | null) => void;
  setConfig: (config: DesignWorkspaceConfig) => void;
  updateConfig: (updates: Partial<DesignWorkspaceConfig>) => void;
  setLastValidation: (validation: DesignWorkspaceValidationResult | null) => void;
  setLastCompileReport: (report: DesignWorkspaceCompileReport | null) => void;
  setHistory: (history: DesignWorkspaceHistory | null) => void;
  setActiveSession: (sessionId: string) => void;
  setProjectContext: (ctx: ProjectContext | null) => void;
  updateProjectContext: (partial: Partial<ProjectContext>) => void;
  setCastFile: (file: string | null, mode: "page" | "component" | "route" | null) => void;
  setProjectStructure: (structure: ProjectStructure) => void;
  clearProjectContext: () => void;
  reset: () => void;
}
