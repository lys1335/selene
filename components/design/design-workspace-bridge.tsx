"use client";

/**
 * Design Workspace Bridge
 *
 * Connects tool results from the `designWorkspace` AI tool to the Zustand store.
 * This component should be rendered alongside `DesignWorkspace` in the layout.
 *
 * It listens for custom events dispatched by the tool UI layer and dispatches
 * the corresponding store actions. This keeps the tool (server-side) decoupled
 * from the store (client-side).
 */

import { useEffect } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";

/** Shape of the event detail dispatched by the tool UI */
interface DesignToolEvent {
  action: string;
  success: boolean;
  data?: {
    componentId?: string;
    code?: string;
    name?: string;
    snapshotId?: string;
    format?: string;
    message?: string;
    prompt?: string;
    mode?: string;
    style?: string;
  };
  error?: string;
}

const EVENT_NAME = "design-workspace-tool-result";

/**
 * Dispatch a design workspace tool result as a CustomEvent.
 * Call this from the tool UI component when a tool result arrives.
 */
export function dispatchDesignToolResult(detail: DesignToolEvent): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

export function DesignWorkspaceBridge() {
  useEffect(() => {
    function handleToolResult(e: Event) {
      // Always read fresh state to avoid stale closure issues
      const store = useDesignWorkspaceStore.getState();
      const { action, success, data, error } = (e as CustomEvent<DesignToolEvent>).detail;

      if (!success) {
        if (error) store.setError(error);
        return;
      }

      switch (action) {
        case "open":
          store.open();
          break;

        case "close":
          store.close();
          break;

        case "generate":
          if (data?.componentId && data.code) {
            const now = new Date().toISOString();
            store.addComponent({
              id: data.componentId,
              name: data.name ?? "Untitled",
              code: data.code,
              mode: (data.mode as "html" | "tailwind") ?? "html",
              style: (data.style as "apple-glass" | "default") ?? "default",
              prompt: data.prompt ?? "",
              createdAt: now,
              updatedAt: now,
            });
            // Auto-open workspace when a component is generated
            if (!store.isOpen) store.open();
          }
          break;

        case "edit":
          if (data?.code && store.activeComponentId) {
            store.updateComponent(store.activeComponentId, { code: data.code });
          }
          break;

        case "snapshot":
          store.takeSnapshot(data?.name);
          break;

        case "restore":
          if (data?.snapshotId) {
            store.restoreSnapshot(data.snapshotId);
          }
          break;

        // export actions don't need store updates — the result goes to the agent
      }
    }

    window.addEventListener(EVENT_NAME, handleToolResult);
    return () => window.removeEventListener(EVENT_NAME, handleToolResult);
  }, []); // stable — getState() always reads fresh

  // This component renders nothing — it's a side-effect bridge
  return null;
}
