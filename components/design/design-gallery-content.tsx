"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Star,
  Clock3,
  Archive,
  Code,
  Trash2,
  ArrowDownToLine,
  Heart,
  Loader2,
  FolderOpen,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchWorkspaceDesignApi,
  type WorkspaceDesignRecord,
  type WorkspaceDesignSummary,
} from "./design-api-client";

const FILTERS = [
  { id: "current", label: "Current", icon: Clock3 },
  { id: "saved", label: "Saved", icon: Archive },
  { id: "favorites", label: "Favorites", icon: Star },
] as const;

type DesignFilter = (typeof FILTERS)[number]["id"];

export function GalleryContent() {
  const addComponent = useDesignWorkspaceStore((s) => s.addComponent);
  const sessionId = useDesignWorkspaceStore((s) => s.sessionId);
  const workspaceComponents = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const setActiveComponent = useDesignWorkspaceStore((s) => s.setActiveComponent);
  const openWorkspace = useDesignWorkspaceStore((s) => s.open);
  const [components, setComponents] = useState<WorkspaceDesignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DesignFilter>("current");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const loadComponents = useCallback(
    async (searchQuery?: string, nextFilter?: DesignFilter) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const activeFilter = nextFilter ?? filter;
        // Use summary action: metadata only. Full code is fetched via "get"
        // only when the user clicks "Open" on a row.
        const result = await fetchWorkspaceDesignApi(
          "workspace-list-summary",
          {
            query: searchQuery || undefined,
            scope: activeFilter === "favorites" ? "all" : activeFilter,
            favoritesOnly: activeFilter === "favorites",
            sessionId: sessionId || undefined,
            limit: 80,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          if (result.success && result.data?.components) {
            setComponents(result.data.components as WorkspaceDesignSummary[]);
          } else {
            setError(result.error || "Failed to load designs");
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[designs] Failed to load:", err);
        if (!controller.signal.aborted) setError("Failed to load designs");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [filter, sessionId],
  );

  useEffect(() => {
    return () => {
      clearTimeout(searchTimeout.current);
      clearTimeout(deleteTimerRef.current);
      clearTimeout(refreshTimeout.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void loadComponents(query, filter);
  }, [filter, loadComponents, query]);

  // Refetch the API-backed "Saved" list when the bridge signals that a tool
  // result mutated persisted design state. Debounced 300ms so burst mutations
  // (e.g. multiple tool calls in one turn) collapse into a single refetch.
  useEffect(() => {
    function handleRefresh() {
      clearTimeout(refreshTimeout.current);
      refreshTimeout.current = setTimeout(() => {
        void loadComponents(query, filter);
      }, 300);
    }
    window.addEventListener("design-gallery-refresh", handleRefresh);
    return () => {
      window.removeEventListener("design-gallery-refresh", handleRefresh);
    };
  }, [filter, loadComponents, query]);

  function handleSearchChange(value: string) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      void loadComponents(value, filter);
    }, 300);
  }

  async function handleFavorite(id: string) {
    try {
      await fetchWorkspaceDesignApi("favorite", { componentId: id });
      void loadComponents(query, filter);
    } catch (err) {
      console.warn("[designs] Favorite toggle failed:", err);
    }
  }

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      await fetchWorkspaceDesignApi("delete", { componentId: id });
      setConfirmDeleteId(null);
      if (selectedId === id) setSelectedId(null);
      void loadComponents(query, filter);
    } catch (err) {
      console.warn("[designs] Delete failed:", err);
    }
  }

  async function handleLoad(component: WorkspaceDesignSummary) {
    // Fetch the full record (with `code` + `prompt`) on demand. The list was
    // loaded via the summary endpoint so those fields aren't present on
    // `component` — we must hit the `get` action before we can push a
    // hydrated entry into the Zustand store.
    setOpening(component.id);
    try {
      const result = await fetchWorkspaceDesignApi("get", {
        componentId: component.id,
      });
      if (!result.success || !result.data?.component) {
        setError(result.error || "Failed to open design");
        return;
      }
      const full = result.data.component as WorkspaceDesignRecord;
      addComponent({
        id: full.id,
        name: full.name,
        code: full.code,
        mode: "tailwind",
        style: full.style as "apple-glass" | "default",
        prompt: full.prompt,
        createdAt: full.createdAt,
        updatedAt: full.updatedAt,
      });
      // Defensive: `addComponent` with full code already sets
      // `activeComponentId` + builds preview, but be explicit so the UI
      // contract holds even if the store's activation heuristic ever shifts.
      // Also ensure the panel is visible — the gallery can be reached while
      // the workspace is minimised (e.g. re-opening a saved design after a
      // session switch), and without this call the component would load
      // into state but the user would see nothing change.
      setActiveComponent(full.id);
      openWorkspace();
    } catch (err) {
      console.warn("[designs] Failed to hydrate:", err);
      setError("Failed to open design");
    } finally {
      setOpening(null);
    }
  }

  const selected = components.find((c) => c.id === selectedId);

  // IDs of designs already open in the workspace — used to deduplicate
  const openIds = new Set(workspaceComponents.map((c) => c.id));

  // Filter workspace components by search query (if any)
  const filteredWorkspace = query
    ? workspaceComponents.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase()),
      )
    : workspaceComponents;

  // Deduplicate API results: exclude items already open in workspace
  const deduplicatedApiComponents = components.filter((c) => !openIds.has(c.id));

  const hasWorkspaceDesigns = filteredWorkspace.length > 0;
  const hasApiDesigns = deduplicatedApiComponents.length > 0;
  const isEmpty = !hasWorkspaceDesigns && !hasApiDesigns && !loading;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 border-b border-border p-2.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search designs..."
            className="h-7 pl-7 text-[11px]"
          />
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Design filter">
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={filter === id ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[11px]"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
            >
              <Icon className="mr-1 h-2.5 w-2.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* ---- Open in Workspace section ---- */}
        {hasWorkspaceDesigns && (
          <div className="border-b border-border p-1.5">
            <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5">
              <Layers className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Open
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                {filteredWorkspace.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5" role="listbox" aria-label="Open workspace designs">
              {filteredWorkspace.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  role="option"
                  aria-selected={activeComponentId === component.id}
                  onClick={() => {
                    // Activate AND ensure the panel is visible. Without the
                    // explicit `openWorkspace()`, clicking an item in the
                    // "Open" list while the workspace is minimised leaves
                    // `isOpen: false` and the user sees no UI change.
                    setActiveComponent(component.id);
                    openWorkspace();
                  }}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                    activeComponentId === component.id
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:border-primary/30 hover:bg-muted/50",
                  )}
                >
                  <Code className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  <p className="min-w-0 flex-1 truncate text-[11px] font-medium">{component.name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline" className="h-3.5 px-1 text-[9px]">
                      {component.mode}
                    </Badge>
                    {activeComponentId === component.id && (
                      <Badge variant="secondary" className="h-3.5 px-1 text-[9px]">
                        Active
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---- Saved / API-fetched designs section ---- */}
        {loading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-1.5 p-6 text-center">
            <p className="text-[11px] text-destructive">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px]"
              onClick={() => void loadComponents(query, filter)}
            >
              Retry
            </Button>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-1.5 p-6 text-center">
            <FolderOpen className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-[11px] text-muted-foreground">
              {query ? "No matches" : "No designs yet"}
            </p>
          </div>
        ) : hasApiDesigns ? (
          <div className="p-1.5">
            {hasWorkspaceDesigns && (
              <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5">
                <Archive className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Saved
                </span>
                <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                  {deduplicatedApiComponents.length}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-0.5" role="listbox" aria-label="Saved designs">
              {deduplicatedApiComponents.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  role="option"
                  aria-selected={selectedId === component.id}
                  onClick={() => setSelectedId(selectedId === component.id ? null : component.id)}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                    selectedId === component.id
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:border-primary/30 hover:bg-muted/50",
                  )}
                >
                  <Code className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  <p className="min-w-0 flex-1 truncate text-[11px] font-medium">{component.name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {component.isFavorite && (
                      <Heart className="h-3 w-3 fill-red-500 text-red-500" />
                    )}
                    <Badge variant="outline" className="h-3.5 px-1 text-[9px]">
                      {component.mode}
                    </Badge>
                    <Badge variant="secondary" className="h-3.5 px-1 text-[9px]">
                      {component.sessionId === sessionId ? "Current" : "Saved"}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </ScrollArea>

      {selected && (
        <div className="space-y-1.5 border-t border-border p-2.5">
          <p className="truncate text-[11px] font-medium">{selected.name}</p>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-6 flex-1 gap-1 text-[11px]"
              disabled={opening === selected.id}
              onClick={() => void handleLoad(selected)}
            >
              {opening === selected.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3 w-3" />
              )}
              Open
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              aria-label={selected.isFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => void handleFavorite(selected.id)}
            >
              <Star
                className={cn(
                  "h-3 w-3",
                  selected.isFavorite && "fill-amber-400 text-amber-400",
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 w-6 p-0", confirmDeleteId === selected.id && "text-destructive")}
              aria-label={confirmDeleteId === selected.id ? "Confirm delete" : "Delete design"}
              onClick={() => void handleDelete(selected.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
