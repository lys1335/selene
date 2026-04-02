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
 *
 * Events are filtered by sessionId so design components don't leak between chats.
 *
 * Race condition fix: Events dispatched before the bridge mounts are queued
 * globally and replayed on first mount. This handles the case where tool UI
 * components in chat history fire events during render before the bridge's
 * useEffect registers its listener.
 */

import { useEffect, useRef } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";

/** Shape of the event detail dispatched by the tool UI */
export interface DesignToolEvent {
  action: string;
  success: boolean;
  /** Session that originated this event — used for cross-chat isolation */
  sessionId?: string;
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
    /** Server-compiled preview HTML for Tailwind components. */
    previewHtml?: string;
  };
  error?: string;
}

const EVENT_NAME = "design-workspace-tool-result";

/**
 * Global queue for events dispatched before any bridge mounts.
 * Once a bridge mounts, it drains this queue and sets `bridgeReady` to true
 * so subsequent events go directly through the DOM listener.
 *
 * Capped at MAX_PENDING to prevent unbounded growth if the bridge never mounts
 * (e.g. workspace feature disabled, render error).
 */
const MAX_PENDING = 50;
let bridgeReady = false;
const pendingEvents: DesignToolEvent[] = [];

/**
 * Dispatch a design workspace tool result as a CustomEvent.
 * Call this from the tool UI component when a tool result arrives.
 *
 * If no bridge is mounted yet, the event is queued for replay on mount.
 */
export function dispatchDesignToolResult(detail: DesignToolEvent): void {
  if (!bridgeReady && pendingEvents.length < MAX_PENDING) {
    pendingEvents.push(detail);
  }
  // Always dispatch — the bridge may be mounted and listening already
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

interface DesignWorkspaceBridgeProps {
  /** Current chat session ID — only events matching this session are processed */
  sessionId?: string;
}

export function DesignWorkspaceBridge({ sessionId }: DesignWorkspaceBridgeProps) {
  const prevSessionIdRef = useRef<string | undefined>(sessionId);

  // Single merged effect: reset store on session change, drain queue, bind listener.
  // Merged to guarantee ordering — reset MUST happen before queue drain.
  useEffect(() => {
    // Reset store when session changes so components don't leak across chats
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      useDesignWorkspaceStore.getState().reset();
    }

    function processEvent(detail: DesignToolEvent) {
      // Session isolation: if bridge has a session, require event to match.
      // Events without sessionId (legacy tool results) are dropped when the
      // bridge is session-aware — this prevents cross-session pollution from
      // old chat history re-renders.
      if (sessionId && detail.sessionId !== sessionId) {
        return;
      }

      // Always read fresh state to avoid stale closure issues
      const store = useDesignWorkspaceStore.getState();
      const { action, success, data, error } = detail;

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
            // If server provided compiled preview HTML (Tailwind), use it
            // instead of the placeholder that addComponent sets.
            if (data.previewHtml) {
              store.setPreviewHtml(data.previewHtml);
            }
            // Auto-open workspace when a component is generated
            if (!store.isOpen) store.open();
          }
          break;

        case "edit":
          if (data?.code) {
            // Use componentId from result if available, fall back to active
            const targetId = data.componentId ?? store.activeComponentId;
            if (targetId) {
              store.updateComponent(targetId, { code: data.code });
              if (data.previewHtml) {
                store.setPreviewHtml(data.previewHtml);
              }
            } else {
              store.setError("Edit could not be applied: no active component.");
            }
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

    function handleToolResult(e: Event) {
      processEvent((e as CustomEvent<DesignToolEvent>).detail);
    }

    // Drain queued events that arrived before this bridge mounted
    bridgeReady = true;
    while (pendingEvents.length > 0) {
      const queued = pendingEvents.shift()!;
      processEvent(queued);
    }

    window.addEventListener(EVENT_NAME, handleToolResult);
    return () => {
      window.removeEventListener(EVENT_NAME, handleToolResult);
      bridgeReady = false;
    };
  }, [sessionId]); // re-bind when session changes

  // This component renders nothing — it's a side-effect bridge
  return null;
}
