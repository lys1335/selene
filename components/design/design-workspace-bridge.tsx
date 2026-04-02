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
 * Events are ALWAYS queued (in addition to dispatching) because the bridge
 * may be in the brief gap between effect cleanup and re-setup during a
 * session switch — the DOM listener is detached but bridgeReady hasn't
 * been set to false yet. The bridge deduplicates on drain.
 */
export function dispatchDesignToolResult(detail: DesignToolEvent): void {
  // Always queue so the bridge can drain on mount/re-bind, regardless of
  // whether a listener is currently attached. The bridge deduplicates.
  if (pendingEvents.length < MAX_PENDING) {
    pendingEvents.push(detail);
  }
  // Also dispatch live in case a listener is already attached
  if (bridgeReady) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
  }
}

interface DesignWorkspaceBridgeProps {
  /** Current chat session ID — only events matching this session are processed */
  sessionId?: string;
}

export function DesignWorkspaceBridge({ sessionId }: DesignWorkspaceBridgeProps) {
  // Start as null (not sessionId!) so the first mount ALWAYS triggers a reset.
  // This prevents stale isOpen:true from leaking when the component remounts
  // (e.g., parent key change, route navigation) — the ref would otherwise
  // re-initialize to the current sessionId, making prev === current, skipping reset.
  const prevSessionIdRef = useRef<string | undefined | null>(null);

  // Single merged effect: reset store on session change, drain queue, bind listener.
  // Merged to guarantee ordering — reset MUST happen before queue drain.
  useEffect(() => {
    // Reset store when session changes (or on first mount) so components don't leak
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

    // Track which events have been processed to deduplicate queue drain vs live dispatch.
    // Uses a WeakSet on the event detail object reference — cheap and automatic GC.
    const processed = new WeakSet<DesignToolEvent>();

    function handleToolResult(e: Event) {
      const detail = (e as CustomEvent<DesignToolEvent>).detail;
      if (processed.has(detail)) return;
      processed.add(detail);
      processEvent(detail);
    }

    // Drain queued events that arrived before this bridge mounted (or during re-bind gap)
    bridgeReady = true;
    const toDrain = pendingEvents.splice(0);
    for (const queued of toDrain) {
      if (processed.has(queued)) continue;
      processed.add(queued);
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
