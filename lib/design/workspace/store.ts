"use client";

import { create } from "zustand";
import {
  DESIGN_BREAKPOINTS,
  type DesignWorkspaceState,
  type DesignWorkspaceSessionState,
  type DesignWorkspaceStatus,
  type DesignComponent,
  type DesignBreakpoint,
  type DesignSnapshot,
  type InspectedElement,
  type ProjectContext,
  type ProjectStructure,
} from "./types";
import {
  DEFAULT_DESIGN_WORKSPACE_CONFIG,
  normalizeDesignWorkspaceConfig,
  type DesignWorkspaceCompileReport,
  type DesignWorkspaceConfig,
  type DesignWorkspaceValidationResult,
} from "./config";
import type { DesignWorkspaceHistory } from "./edit-history";
import { buildDesignPreviewHtml } from "./preview";

function buildPreviewMarkup(component: Pick<DesignComponent, "code" | "mode" | "name">): string {
  try {
    return buildDesignPreviewHtml({
      code: component.code,
      componentName: component.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview unavailable.";
    return `<!DOCTYPE html><html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;background:#111827;color:#f9fafb;"><pre style="white-space:pre-wrap;">${message}</pre></body></html>`;
  }
}

// ---------------------------------------------------------------------------
// Session cache (module-level, NOT in the store)
// ---------------------------------------------------------------------------
const MAX_CACHED_SESSIONS = 10;
const sessionCache = new Map<string, DesignWorkspaceSessionState>();

/** Basic LRU eviction: delete the oldest entry when the cache exceeds max. */
function cacheSessionState(sessionId: string, state: DesignWorkspaceSessionState): void {
  // Re-insert to move to "newest" position (Map preserves insertion order)
  sessionCache.delete(sessionId);
  sessionCache.set(sessionId, state);

  if (sessionCache.size > MAX_CACHED_SESSIONS) {
    // Delete the oldest (first) key
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
}

function extractSessionState(store: DesignWorkspaceState): DesignWorkspaceSessionState {
  return {
    isOpen: store.isOpen,
    status: store.status,
    components: store.components,
    activeComponentId: store.activeComponentId,
    snapshots: store.snapshots,
    selectedBreakpoint: store.selectedBreakpoint,
    previewHtml: store.previewHtml,
    showCode: store.showCode,
    error: store.error,
    inspectorEnabled: store.inspectorEnabled,
    selectedElement: store.selectedElement,
    selectedElements: store.selectedElements,
    config: store.config,
    lastValidation: store.lastValidation,
    lastCompileReport: store.lastCompileReport,
    history: store.history,
    projectContext: store.projectContext,
  };
}

const initialSessionState: DesignWorkspaceSessionState = {
  isOpen: false,
  status: "idle" as DesignWorkspaceStatus,
  components: [] as DesignComponent[],
  activeComponentId: null as string | null,
  snapshots: [] as DesignSnapshot[],
  selectedBreakpoint: DESIGN_BREAKPOINTS[0], // responsive
  previewHtml: "",
  showCode: false,
  error: null,
  inspectorEnabled: false,
  selectedElement: null,
  selectedElements: [],
  config: { ...DEFAULT_DESIGN_WORKSPACE_CONFIG },
  lastValidation: null,
  lastCompileReport: null,
  history: null,
  projectContext: null,
};

const initialState = {
  ...initialSessionState,
  sessionId: null as string | null,
};

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set, get) => ({
  ...initialState,

  open: () => {
    set({ isOpen: true });
  },

  close: () => {
    set({ isOpen: false });
  },

  setStatus: (status: DesignWorkspaceStatus) => {
    set({ status });
  },

  addComponent: (component: DesignComponent) => {
    const current = get();
    // Deduplicate: if a component with the same ID already exists, select it
    // and update its data to keep store and preview in sync
    const existingIndex = current.components.findIndex((c) => c.id === component.id);
    if (existingIndex !== -1) {
      const nextComponents = [...current.components];
      nextComponents[existingIndex] = { ...nextComponents[existingIndex], ...component };
      set({
        components: nextComponents,
        activeComponentId: component.id,
        previewHtml: buildPreviewMarkup(component),
      });
      return;
    }
    set({
      components: [...current.components, component],
      activeComponentId: component.id,
      previewHtml: buildPreviewMarkup(component),
    });
  },

  updateComponent: (id: string, updates: Partial<DesignComponent>) => {
    const current = get();
    const now = new Date().toISOString();
    const nextComponents = current.components.map((c) =>
      c.id === id ? { ...c, ...updates, updatedAt: now } : c,
    );
    const nextState: Partial<DesignWorkspaceState> = { components: nextComponents };

    if (current.activeComponentId === id) {
      const updatedComponent = nextComponents.find((component) => component.id === id);
      if (updatedComponent) {
        nextState.previewHtml = buildPreviewMarkup(updatedComponent);
      }
    }

    set(nextState);
  },

  removeComponent: (id: string) => {
    const current = get();
    const nextComponents = current.components.filter((c) => c.id !== id);
    const nextSnapshots = current.snapshots.filter((s) => s.componentId !== id);
    const nextState: Partial<DesignWorkspaceState> = {
      components: nextComponents,
      snapshots: nextSnapshots,
    };

    if (current.activeComponentId === id) {
      const fallback = nextComponents[0] ?? null;
      nextState.activeComponentId = fallback?.id ?? null;
      nextState.previewHtml = fallback ? buildPreviewMarkup(fallback) : "";
    }

    set(nextState);
  },

  setActiveComponent: (id: string | null) => {
    const current = get();
    // Normalize invalid IDs to null to prevent impossible state
    const component = id ? current.components.find((c) => c.id === id) : null;
    set({
      activeComponentId: component ? id : null,
      previewHtml: component ? buildPreviewMarkup(component) : "",
      selectedElement: null,
      selectedElements: [],
    });
  },

  setPreviewHtml: (html: string) => {
    set({ previewHtml: html });
  },

  setBreakpoint: (breakpoint: DesignBreakpoint) => {
    set({ selectedBreakpoint: breakpoint });
  },

  toggleCode: () => {
    set({ showCode: !get().showCode });
  },

  toggleInspector: () => {
    const next = !get().inspectorEnabled;
    set({
      inspectorEnabled: next,
      selectedElement: next ? get().selectedElement : null,
      selectedElements: next ? get().selectedElements : [],
    });
  },

  setSelectedElement: (el: InspectedElement | null) => {
    set({ selectedElement: el, selectedElements: el ? [el] : [] });
  },

  setSelectedElements: (elements: InspectedElement[]) => {
    const normalized = elements.filter((element, index, source) => {
      const key = element.selector;
      return key ? source.findIndex((candidate) => candidate.selector === key) === index : index === 0;
    });
    set({
      selectedElements: normalized,
      selectedElement: normalized[0] ?? null,
    });
  },

  toggleSelectedElement: (el: InspectedElement) => {
    const current = get().selectedElements;
    const exists = current.some((candidate) => candidate.selector === el.selector);
    const next = exists
      ? current.filter((candidate) => candidate.selector !== el.selector)
      : [...current, el];
    set({
      selectedElements: next,
      selectedElement: next[0] ?? null,
    });
  },

  removeSelectedElement: (selector: string) => {
    const next = get().selectedElements.filter((element) => element.selector !== selector);
    set({
      selectedElements: next,
      selectedElement: next[0] ?? null,
    });
  },

  clearSelectedElements: () => {
    set({ selectedElements: [], selectedElement: null });
  },

  takeSnapshot: (label?: string, id?: string) => {
    const current = get();
    if (!current.activeComponentId) {
      return;
    }

    const component = current.components.find((c) => c.id === current.activeComponentId);
    if (!component) {
      return;
    }

    // Dedup: skip if the last snapshot for this component has identical code
    const lastForComponent = [...current.snapshots]
      .reverse()
      .find((s) => s.componentId === component.id);
    if (lastForComponent && lastForComponent.code === component.code) {
      return;
    }

    const snapshot: DesignSnapshot = {
      id: id ?? crypto.randomUUID(),
      componentId: component.id,
      code: component.code,
      label,
      createdAt: new Date().toISOString(),
    };

    set({ snapshots: [...current.snapshots, snapshot] });
  },

  restoreSnapshot: (snapshotId: string) => {
    const current = get();
    const snapshot = current.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      set({ error: `Snapshot "${snapshotId}" not found.` });
      return;
    }

    // Verify the target component still exists
    const targetExists = current.components.some((c) => c.id === snapshot.componentId);
    if (!targetExists) {
      set({ error: `Component for snapshot "${snapshotId}" was deleted.` });
      return;
    }

    const now = new Date().toISOString();
    const nextComponents = current.components.map((c) =>
      c.id === snapshot.componentId ? { ...c, code: snapshot.code, updatedAt: now } : c,
    );
    const nextState: Partial<DesignWorkspaceState> = { components: nextComponents, error: null };

    if (current.activeComponentId === snapshot.componentId) {
      const updatedComponent = nextComponents.find((component) => component.id === snapshot.componentId);
      nextState.previewHtml = updatedComponent ? buildPreviewMarkup(updatedComponent) : "";
    }

    set(nextState);
  },

  clearError: () => {
    set({ error: null });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  setConfig: (config: DesignWorkspaceConfig) => {
    const normalized = normalizeDesignWorkspaceConfig(config);
    // Guard: sourceMode "project" requires an active projectContext
    if (normalized.sourceMode === "project" && !get().projectContext) {
      normalized.sourceMode = "sandbox";
    }
    set({ config: normalized });
  },

  updateConfig: (updates: Partial<DesignWorkspaceConfig>) => {
    const normalized = normalizeDesignWorkspaceConfig({ ...get().config, ...updates });
    // Guard: sourceMode "project" requires an active projectContext
    if (normalized.sourceMode === "project" && !get().projectContext) {
      normalized.sourceMode = "sandbox";
    }
    set({ config: normalized });
  },

  setLastValidation: (validation: DesignWorkspaceValidationResult | null) => {
    set({ lastValidation: validation });
  },

  setLastCompileReport: (report: DesignWorkspaceCompileReport | null) => {
    set({ lastCompileReport: report });
  },

  setHistory: (history: DesignWorkspaceHistory | null) => {
    set({ history });
  },

  setActiveSession: (sessionId: string) => {
    const current = get();

    // Save current session state to cache (if we have a session)
    if (current.sessionId) {
      cacheSessionState(current.sessionId, extractSessionState(current));
    }

    // Restore target session from cache, or initialize fresh
    const cached = sessionCache.get(sessionId);
    if (cached) {
      // Move to newest position in cache
      sessionCache.delete(sessionId);
      set({ ...cached, sessionId });
    } else {
      set({
        ...initialSessionState,
        selectedBreakpoint: { ...DESIGN_BREAKPOINTS[0] },
        sessionId,
      });
    }
  },

  setProjectContext: (ctx: ProjectContext | null) => {
    set({
      projectContext: ctx,
      config: normalizeDesignWorkspaceConfig({
        ...get().config,
        sourceMode: ctx ? "project" : "sandbox",
        projectRoot: ctx?.projectRoot,
      }),
    });
  },

  updateProjectContext: (partial: Partial<ProjectContext>) => {
    const current = get().projectContext;
    if (!current) return;
    const merged = { ...current, ...partial };

    // Validate cross-field invariants
    if (
      (merged.worktreeStatus === "active" || merged.worktreeStatus === "finalizing") &&
      merged.worktreePath == null
    ) {
      console.warn(
        `[design-workspace] updateProjectContext rejected: worktreeStatus="${merged.worktreeStatus}" requires a non-null worktreePath`,
      );
      return;
    }
    if (merged.castFile != null && merged.castMode == null) {
      console.warn(
        `[design-workspace] updateProjectContext rejected: castFile is set but castMode is null`,
      );
      return;
    }

    set({ projectContext: merged });
  },

  setCastFile: (file: string | null, mode: "page" | "component" | "route" | null) => {
    const current = get().projectContext;
    if (!current) return;
    set({ projectContext: { ...current, castFile: file, castMode: mode } });
  },

  setProjectStructure: (structure: ProjectStructure) => {
    const current = get().projectContext;
    if (!current) return;
    set({ projectContext: { ...current, projectStructure: structure } });
  },

  clearProjectContext: () => {
    set({
      projectContext: null,
      config: normalizeDesignWorkspaceConfig({
        ...get().config,
        sourceMode: "sandbox",
        projectRoot: undefined,
      }),
    });
  },

  reset: () => {
    set({ ...initialState, selectedBreakpoint: { ...DESIGN_BREAKPOINTS[0] }, projectContext: null });
  },
}));
