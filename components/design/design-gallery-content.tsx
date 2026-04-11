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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchWorkspaceDesignApi, type WorkspaceDesignRecord } from "./design-api-client";

const FILTERS = [
  { id: "current", label: "Current", icon: Clock3 },
  { id: "saved", label: "Saved", icon: Archive },
  { id: "favorites", label: "Favorites", icon: Star },
] as const;

type DesignFilter = (typeof FILTERS)[number]["id"];

export function GalleryContent() {
  const addComponent = useDesignWorkspaceStore((s) => s.addComponent);
  const sessionId = useDesignWorkspaceStore((s) => s.sessionId);
  const [components, setComponents] = useState<WorkspaceDesignRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DesignFilter>("current");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
        const result = await fetchWorkspaceDesignApi(
          "workspace-list",
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
            setComponents(result.data.components as WorkspaceDesignRecord[]);
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
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void loadComponents(query, filter);
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

  function handleLoad(component: WorkspaceDesignRecord) {
    addComponent({
      id: component.id,
      name: component.name,
      code: component.code,
      mode: "tailwind",
      style: component.style as "apple-glass" | "default",
      prompt: component.prompt,
      createdAt: component.createdAt,
      updatedAt: component.updatedAt,
    });
  }

  const selected = components.find((c) => c.id === selectedId);

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
        ) : components.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 p-6 text-center">
            <FolderOpen className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-[11px] text-muted-foreground">
              {query ? "No matches" : "No designs yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 p-2.5" role="listbox" aria-label="Workspace designs">
            {components.map((component) => (
              <button
                key={component.id}
                type="button"
                role="option"
                aria-selected={selectedId === component.id}
                onClick={() => setSelectedId(selectedId === component.id ? null : component.id)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
                  selectedId === component.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30",
                )}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                  {component.previewUrl ? (
                    <img
                      src={component.previewUrl}
                      alt={component.name}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Code className="h-5 w-5 text-muted-foreground/40" />
                    </div>
                  )}
                  {component.isFavorite && (
                    <div className="absolute right-1 top-1">
                      <Heart className="h-3 w-3 fill-red-500 text-red-500" />
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-1.5">
                  <p className="truncate text-[11px] font-medium">{component.name}</p>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="h-3.5 px-1 text-[11px]">
                      {component.mode}
                    </Badge>
                    {component.sessionId === sessionId ? (
                      <Badge variant="secondary" className="h-3.5 px-1 text-[11px]">
                        Current
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="h-3.5 px-1 text-[11px]">
                        Saved
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {selected && (
        <div className="space-y-1.5 border-t border-border p-2.5">
          <p className="truncate text-[11px] font-medium">{selected.name}</p>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-6 flex-1 gap-1 text-[11px]"
              onClick={() => handleLoad(selected)}
            >
              <ArrowDownToLine className="h-3 w-3" />
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
