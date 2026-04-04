export interface DesignComponent {
  id: string;
  name: string;
  code: string;
  mode: "html" | "tailwind";
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
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export type DesignWorkspaceStatus = "idle" | "generating" | "editing" | "exporting";

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
}

export interface DesignWorkspaceState extends DesignWorkspaceSessionState {
  // Session tracking
  sessionId: string | null;

  // Actions
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
  takeSnapshot: (label?: string, id?: string) => void;
  restoreSnapshot: (snapshotId: string) => void;
  clearError: () => void;
  setError: (error: string) => void;
  setActiveSession: (sessionId: string) => void;
  reset: () => void;
}
