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
import { fetchWorkspaceDesignApi, type WorkspaceDesignRecord } from "./design-api-client";

/** Shape of the event detail dispatched by the tool UI */
export interface DesignToolEvent {
  action: string;
  success: boolean;
  /** Session that originated this event — used for cross-chat isolation */
  sessionId?: string;
  /**
   * True when the tool UI detected that the originating tool call transitioned
   * through a live-execution state (`input-streaming` / `input-available`)
   * during the current browser session — i.e. the user is watching the
   * generate/edit happen NOW. False (or undefined) means the event is a
   * replay from chat history: the tool completed in a previous session and
   * the UI is re-rendering a persisted result. Replays skip eager hydration
   * (no DB fetch, no store activation) so large histories don't bloat memory.
   */
  isLive?: boolean;
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
    /**
     * Flag set by the tool when heavy fields (`code`, `previewHtml`) were
     * stripped from the payload to stay under the AI runtime's token cap.
     * When true, the bridge must refetch the full component from the DB.
     */
    truncated?: boolean;
    hydrateRef?: { kind: "gallery"; componentId: string };
    /**
     * Server-stamped freshness marker. Consumed by the tool-UI for `isLive`
     * detection; the bridge doesn't read it directly but it rides along on
     * the event detail so downstream subscribers have access.
     */
    generatedAt?: number;
  };
  error?: string;
}

/**
 * Event dispatched after a tool result mutates persisted design state.
 * The design gallery listens for this and refetches its API-backed "Saved"
 * list so it stays in sync with the Zustand store (which only holds the
 * "Open in Workspace" slice). Fires on generate / edit / patch only —
 * not on open/close/list/status/etc. that don't change persisted records.
 */
const GALLERY_REFRESH_EVENT = "design-gallery-refresh";

function signalGalleryRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GALLERY_REFRESH_EVENT));
}

/**
 * Deduplicate in-flight hydrate requests so repeated dispatches for the same
 * componentId (e.g. live dispatch + queue drain) only trigger one API call.
 */
const inflightHydration = new Map<string, Promise<WorkspaceDesignRecord | null>>();

async function fetchComponentFromGallery(
  componentId: string,
): Promise<WorkspaceDesignRecord | null> {
  const existing = inflightHydration.get(componentId);
  if (existing) return existing;

  const request = (async () => {
    try {
      const response = await fetchWorkspaceDesignApi("get", { componentId });
      if (response.success && response.data && typeof response.data === "object") {
        const component = (response.data as { component?: WorkspaceDesignRecord }).component;
        return component ?? null;
      }
      return null;
    } catch (error) {
      console.warn("[design-bridge] Failed to hydrate component", componentId, error);
      return null;
    } finally {
      // Small delay before clearing so a live dispatch + immediate queue drain
      // collapse into one request but subsequent (post-commit) refetches work.
      setTimeout(() => inflightHydration.delete(componentId), 250);
    }
  })();

  inflightHydration.set(componentId, request);
  return request;
}

function upsertComponentFromData(
  detail: NonNullable<DesignToolEvent["data"]>,
  code: string,
  meta?: Pick<WorkspaceDesignRecord, "createdAt" | "updatedAt"> | null,
): void {
  if (!detail.componentId) return;
  const store = useDesignWorkspaceStore.getState();
  const now = new Date().toISOString();
  store.addComponent({
    id: detail.componentId,
    name: detail.name ?? "Untitled",
    code,
    mode: "tailwind",
    style: (detail.style as "apple-glass" | "default") ?? "default",
    prompt: detail.prompt ?? "",
    createdAt: meta?.createdAt ?? now,
    updatedAt: meta?.updatedAt ?? now,
  });
  if (code && detail.previewHtml) {
    store.setPreviewHtml(detail.previewHtml);
  }
}

/**
 * Add a metadata-only stub to the store — no fetch, no code, no preview.
 * Used for replays of historical tool results so the gallery shows the
 * component was generated without paying the cost of a full hydration up
 * front. Clicking into it, or a future live tool call, upgrades it to a
 * fully-hydrated entry.
 */
function upsertComponentSummary(
  detail: NonNullable<DesignToolEvent["data"]>,
): void {
  if (!detail.componentId) return;
  const store = useDesignWorkspaceStore.getState();
  const existing = store.components.find((c) => c.id === detail.componentId);
  // Skip if already tracked — don't clobber a hydrated entry with an empty stub.
  if (existing) return;
  const now = new Date().toISOString();
  store.addComponent({
    id: detail.componentId,
    name: detail.name ?? "Untitled",
    code: "",
    mode: "tailwind",
    style: (detail.style as "apple-glass" | "default") ?? "default",
    prompt: detail.prompt ?? "",
    createdAt: now,
    updatedAt: now,
    codeStripped: true,
  });
}

async function hydrateComponent(
  data: NonNullable<DesignToolEvent["data"]>,
  action: string,
): Promise<void> {
  if (!data.componentId) return;

  // Fast path: the tool payload still has the code inline (small component).
  if (data.code) {
    upsertComponentFromData(data, data.code);
    return;
  }

  // Slim path: refetch the full record from the DB via componentId.
  const hydratedId = data.hydrateRef?.componentId ?? data.componentId;
  const record = await fetchComponentFromGallery(hydratedId);
  if (!record) {
    const store = useDesignWorkspaceStore.getState();
    store.setError(
      `Unable to load design "${data.name ?? hydratedId}". The component was generated but could not be fetched — try again or refresh.`,
    );
    return;
  }

  upsertComponentFromData(
    {
      ...data,
      name: data.name ?? record.name,
      prompt: data.prompt ?? record.prompt,
      style: data.style ?? record.style,
    },
    record.code,
    { createdAt: record.createdAt, updatedAt: record.updatedAt },
  );

  // If the tool provided server-compiled preview HTML and it's the active
  // component, prefer it over the placeholder that addComponent builds.
  // (upsertComponentFromData already applies it when present.)
  void action;
}

/**
 * @internal Exported for unit testing. The test suite drives this directly
 * to assert the open + activate + hydrate contract without having to mount
 * the full React tree or simulate window events. Production callers go
 * through `dispatchDesignToolResult` / the DOM listener.
 */
export function applyDesignToolResultToStore(detail: DesignToolEvent): void {
  const store = useDesignWorkspaceStore.getState();
  const { action, success, data, error, isLive } = detail;

  if (!success) {
    if (error) store.setError(error);
    // Don't return — fall through to process any data included in the result.
    // Compile failures and downgraded validation warnings still carry
    // componentId, code, and previewHtml that the store needs to display
    // the component in the sidebar and preview pane.
  }

  // Replay events (historical tool results rendered during chat scrollback)
  // never trigger a DB hydration, never open the workspace, and never set
  // active. They add a lightweight stub so the gallery shows the component
  // exists — clicking it (or a future live tool call) does the real fetch.
  // This prevents the N-component eager-hydration memory bloat that made
  // the workspace sluggish across all sessions.
  const isReplay = !isLive;

  switch (action) {
    case "open":
      // Only react to live open events — replaying a historical "open" from
      // another session's chat history must not force-open the panel here.
      if (isLive) store.open();
      break;

    case "close":
      if (isLive) store.close();
      break;

    case "generate":
      if (data?.componentId) {
        if (isReplay) {
          // Cheap: add a stub so the gallery's "Open" list shows the id.
          upsertComponentSummary(data);
          break;
        }
        // Live path: open the workspace, hydrate from DB, refresh gallery.
        if (!store.isOpen) store.open();
        void hydrateComponent(data, action);
        signalGalleryRefresh();
      }
      break;

    case "edit":
    case "patch":
      if (data?.componentId) {
        if (isReplay) {
          upsertComponentSummary(data);
          break;
        }
        void hydrateComponent(data, action);
        signalGalleryRefresh();
      } else if (data?.code) {
        if (isReplay) break;
        const targetId = store.activeComponentId;
        if (targetId) {
          store.updateComponent(targetId, { code: data.code });
          if (data.previewHtml) store.setPreviewHtml(data.previewHtml);
          signalGalleryRefresh();
        } else {
          store.setError(
            `${action === "patch" ? "Patch" : "Edit"} could not be applied: no active component.`,
          );
        }
      } else if (isLive) {
        store.setError(
          `${action === "patch" ? "Patch" : "Edit"} could not be applied: no component reference returned.`,
        );
      }
      break;

    case "readSource":
    case "list":
    case "status":
    case "install":
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
