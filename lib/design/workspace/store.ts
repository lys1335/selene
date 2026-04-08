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
} from "./types";
import { buildDesignPreviewHtml } from "./preview";

function buildPreviewMarkup(component: Pick<DesignComponent, "code" | "mode" | "name">): string {
  try {
    return buildDesignPreviewHtml({
      code: component.code,
      mode: component.mode,
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
  };
}

const initialSessionState: DesignWorkspaceSessionState = {
  isOpen: false,
  status: "idle" as DesignWorkspaceStatus,
  components: [] as DesignComponent[],
  activeComponentId: null as string | null,
  snapshots: [] as DesignSnapshot[],
  selectedBreakpoint: DESIGN_BREAKPOINTS[2], // desktop
  previewHtml: "",
  showCode: false,
  error: null as string | null,
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

  setError: (error: string) => {
    set({ error });
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
        selectedBreakpoint: { ...DESIGN_BREAKPOINTS[2] },
        sessionId,
      });
    }
  },

  reset: () => {
    set({ ...initialState, selectedBreakpoint: { ...DESIGN_BREAKPOINTS[2] } });
  },
}));
