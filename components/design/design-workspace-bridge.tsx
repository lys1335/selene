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
 * globally (keyed by sessionId) and replayed on first mount. This handles the
 * case where tool UI components in chat history fire events during render before
 * the bridge's useEffect registers its listener.
 */

import { useEffect, useRef } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";

/** Shape of the event detail dispatched by the tool UI */
interface DesignToolEvent {
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
    compileReport?: import("@/lib/design/workspace/config").DesignWorkspaceCompileReport;
    postEditValidation?: import("@/lib/design/workspace/config").DesignWorkspaceValidationResult;
    history?: import("@/lib/design/workspace/edit-history").DesignWorkspaceHistory;
    config?: import("@/lib/design/workspace/config").DesignWorkspaceConfig;
    /** Project metadata returned by detect/browse/cast/open actions */
    framework?: Record<string, unknown>;
    projectStructure?: Record<string, unknown>;
    castFile?: string;
    castMode?: "page" | "component" | "route";
    rendererInfo?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

function applyDesignToolResultToStore(detail: DesignToolEvent): void {
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
          mode: "tailwind",
          style: (data.style as "apple-glass" | "default") ?? "default",
          prompt: data.prompt ?? "",
          createdAt: now,
          updatedAt: now,
        });
        if (data.previewHtml) {
          store.setPreviewHtml(data.previewHtml);
        }
        if (!store.isOpen) store.open();
      }
      break;

    case "edit":
    case "patch":
      if (data?.code) {
        const targetId = data.componentId ?? store.activeComponentId;
        if (targetId) {
          store.updateComponent(targetId, { code: data.code });
          if (data.previewHtml) {
            store.setPreviewHtml(data.previewHtml);
          }
        } else {
          store.setError(`${action === "patch" ? "Patch" : "Edit"} could not be applied: no active component.`);
        }
      }
      break;

    case "readSource":
    case "list":
    case "status":
    case "install":
      // Informational actions — no store updates needed
      break;

    case "detect": {
      // Parse framework and structure from the prompt field (JSON-encoded by the tool)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let framework: any | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let structure: any | undefined;

      // Prefer explicit fields; fall back to parsing the prompt JSON
      if (data?.framework) {
        framework = data.framework;
      }
      if (data?.projectStructure) {
        structure = data.projectStructure;
      }
      if ((!framework || !structure) && data?.prompt) {
        try {
          const parsed = JSON.parse(data.prompt);
          if (!framework && parsed.framework) framework = parsed.framework;
          if (!structure && parsed.structure) structure = parsed.structure;
        } catch {
          // prompt wasn't JSON — ignore
        }
      }

      if (framework) {
        store.setProjectContext({
          projectRoot: "",
          framework,
          worktreePath: null,
          worktreeBranch: null,
          syncFolderId: null,
          worktreeStatus: "none",
          castFile: null,
          castMode: null,
          rendererInfo: null,
          projectStructure: structure ?? null,
        });
      }
      if (structure && store.projectContext) {
        store.setProjectStructure(structure);
      }
      break;
    }

    case "browse": {
      // Parse structure entries from prompt and update projectStructure
      if (data?.projectStructure) {
        if (store.projectContext) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store.setProjectStructure(data.projectStructure as any);
        }
      } else if (data?.prompt) {
        try {
          const entries = JSON.parse(data.prompt);
          if (Array.isArray(entries) && store.projectContext) {
            // Entries are a flat list — update as a best-effort structure
            const pages = entries.filter((e: { type: string }) => e.type === "page");
            const components = entries.filter((e: { type: string }) => e.type === "component");
            const layouts = entries.filter((e: { type: string }) => e.type === "layout");
            const styles = entries.filter((e: { type: string }) => e.type === "style");
            store.setProjectStructure({ pages, components, layouts, styles });
          }
        } catch {
          // Not JSON — ignore
        }
      }
      break;
    }

    case "cast":
      if (data?.componentId && data.code) {
        const now = new Date().toISOString();
        store.addComponent({
          id: data.componentId,
          name: data.name ?? "Project Component",
          code: data.code,
          mode: "tailwind",
          style: "default",
          prompt: "",
          createdAt: now,
          updatedAt: now,
        });
      }
      if (data?.previewHtml) {
        store.setPreviewHtml(data.previewHtml);
      }
      // Update castFile and rendererInfo in project context
      if (store.projectContext) {
        if (data?.castFile || data?.componentId) {
          const castFile = data?.castFile ?? null;
          const castMode = data?.castMode ?? null;
          store.setCastFile(castFile, castMode);
        }
        if (data?.rendererInfo) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store.updateProjectContext({ rendererInfo: data.rendererInfo as any });
        }
      }
      break;

    case "sync-back":
      // Sync-back is a finalization action — no preview update
      break;

  }
}

const EVENT_NAME = "design-workspace-tool-result";

/**
 * Global queue for events dispatched before any bridge mounts.
 * Keyed by sessionId so each session accumulates its own queue.
 *
 * Once a bridge mounts for a session, it drains only that session's events
 * and sets `bridgeReady` to true so subsequent events go directly through
 * the DOM listener.
 *
 * Events without a sessionId are keyed under "__nosession__".
 *
 * Capped at MAX_PENDING per session to prevent unbounded growth if the
 * bridge never mounts (e.g. workspace feature disabled, render error).
 */
const MAX_PENDING = 50;
let bridgeReady = false;
const pendingEvents = new Map<string, DesignToolEvent[]>();

const NO_SESSION_KEY = "__nosession__";

function getSessionKey(event: DesignToolEvent): string {
  return event.sessionId || NO_SESSION_KEY;
}

/**
 * Dispatch a design workspace tool result as a CustomEvent.
 * Call this from the tool UI component when a tool result arrives.
 *
 * If no bridge is mounted yet, the event is queued (by session) for replay on mount.
 * Events are ALWAYS queued (in addition to dispatching) because the bridge
 * may be in the brief gap between effect cleanup and re-setup during a
 * session switch — the DOM listener is detached but bridgeReady hasn't
 * been set to false yet. The bridge deduplicates on drain.
 */
export function dispatchDesignToolResult(detail: DesignToolEvent): void {
  // Queue by session so the correct bridge mount drains the right events
  const key = getSessionKey(detail);
  let queue = pendingEvents.get(key);
  if (!queue) {
    queue = [];
    pendingEvents.set(key, queue);
  }
  if (queue.length < MAX_PENDING) {
    queue.push(detail);
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
  // Start as null (not sessionId!) so the first mount ALWAYS triggers a session switch.
  // This prevents stale isOpen:true from leaking when the component remounts
  // (e.g., parent key change, route navigation) — the ref would otherwise
  // re-initialize to the current sessionId, making prev === current, skipping reset.
  const prevSessionIdRef = useRef<string | undefined | null>(null);

  // Listen for cast requests from the project browser sidebar.
  // Instead of fabricating a fake result, update the store's castFile to signal
  // intent and dispatch a "cast-pending" event so the chat layer can trigger
  // the actual designWorkspace tool call with the cast action.
  useEffect(() => {
    const handleCastRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        targetFile?: string;
        castMode?: "page" | "component" | "route";
      };
      const store = useDesignWorkspaceStore.getState();
      if (store.projectContext && detail.targetFile) {
        store.setCastFile(detail.targetFile, detail.castMode ?? "component");
      }
      // Emit a pending event so the chat/tool layer can pick it up and invoke
      // the actual cast action (the bridge itself cannot trigger server-side tools).
      window.dispatchEvent(
        new CustomEvent("design-workspace-cast-pending", {
          detail: { targetFile: detail.targetFile, castMode: detail.castMode, sessionId },
        }),
      );
    };
    window.addEventListener("design-workspace-cast-request", handleCastRequest);
    return () => window.removeEventListener("design-workspace-cast-request", handleCastRequest);
  }, [sessionId]);

  // Single merged effect: switch session on change, drain queue, bind listener.
  // Merged to guarantee ordering — session switch MUST happen before queue drain.
  useEffect(() => {
    // Switch session when session changes (or on first mount)
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      if (sessionId) {
        useDesignWorkspaceStore.getState().setActiveSession(sessionId);
      } else {
        useDesignWorkspaceStore.getState().reset();
      }
    }

    function processEvent(detail: DesignToolEvent) {
      // Session isolation: if bridge has a session, require event to match.
      // Events without sessionId (legacy tool results) are dropped when the
      // bridge is session-aware — this prevents cross-session pollution from
      // old chat history re-renders.
      if (sessionId && detail.sessionId !== sessionId) {
        return;
      }

      applyDesignToolResultToStore(detail);
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

    // Drain only this session's queued events
    bridgeReady = true;
    const queueKey = sessionId || NO_SESSION_KEY;
    const toDrain = pendingEvents.get(queueKey);
    if (toDrain) {
      pendingEvents.delete(queueKey);
      for (const queued of toDrain) {
        if (processed.has(queued)) continue;
        processed.add(queued);
        processEvent(queued);
      }
    }

    window.addEventListener(EVENT_NAME, handleToolResult);
    return () => {
      window.removeEventListener(EVENT_NAME, handleToolResult);
      // Set bridgeReady to false but DON'T drain — events accumulate until next mount
      bridgeReady = false;
    };
  }, [sessionId]); // re-bind when session changes

  // This component renders nothing — it's a side-effect bridge
  return null;
}
