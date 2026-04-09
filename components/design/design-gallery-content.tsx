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
  Clock,
  Code,
  Trash2,
  ArrowDownToLine,
  Heart,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchGalleryApi, type GalleryComponent } from "./design-api-client";

export function GalleryContent() {
  const addComponent = useDesignWorkspaceStore((s) => s.addComponent);
  const [components, setComponents] = useState<GalleryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const loadComponents = useCallback(
    async (searchQuery?: string, favoritesOnly?: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchGalleryApi(
          "search",
          { query: searchQuery || undefined, favoritesOnly: favoritesOnly === true, limit: 60 },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          if (result.success && result.data?.components) {
            setComponents(result.data.components as GalleryComponent[]);
          } else {
            setError(result.error || "Failed to load gallery");
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[design-gallery] Failed to load:", err);
        if (!controller.signal.aborted) setError("Failed to load gallery");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      clearTimeout(searchTimeout.current);
      clearTimeout(deleteTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    loadComponents(query, filter === "favorites");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, loadComponents]);

  function handleSearchChange(value: string) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      loadComponents(value, filter === "favorites");
    }, 300);
  }

  async function handleFavorite(id: string) {
    try {
      await fetchGalleryApi("favorite", { componentId: id });
      loadComponents(query, filter === "favorites");
    } catch (err) {
      console.warn("[design-gallery] Favorite toggle failed:", err);
    }
  }

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      // Auto-reset after 3 seconds (keyboard-safe, no onBlur)
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      await fetchGalleryApi("delete", { componentId: id });
      setConfirmDeleteId(null);
      if (selectedId === id) setSelectedId(null);
      loadComponents(query, filter === "favorites");
    } catch (err) {
      console.warn("[design-gallery] Delete failed:", err);
    }
  }

  function handleLoad(component: GalleryComponent) {
    if (component.code?.startsWith("cached:")) return;
    addComponent({
      id: crypto.randomUUID(),
      name: component.name,
      code: component.code,
      mode: "tailwind",
      style: component.style as "apple-glass" | "default",
      prompt: component.prompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const selected = components.find((c) => c.id === selectedId);

  return (
    <div className="flex h-full flex-col">
      {/* Search + Filter */}
      <div className="space-y-1.5 border-b border-border p-2.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search..."
            className="h-7 pl-7 text-[11px]"
          />
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Gallery filter">
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-5 px-2 text-[11px]"
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
          >
            <Clock className="mr-1 h-2.5 w-2.5" />
            Recent
          </Button>
          <Button
            variant={filter === "favorites" ? "secondary" : "ghost"}
            size="sm"
            className="h-5 px-2 text-[11px]"
            role="tab"
            aria-selected={filter === "favorites"}
            onClick={() => setFilter("favorites")}
          >
            <Star className="mr-1 h-2.5 w-2.5" />
            Favorites
          </Button>
        </div>
      </div>

      {/* Grid */}
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
              onClick={() => loadComponents(query, filter === "favorites")}
            >
              Retry
            </Button>
          </div>
        ) : components.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 p-6 text-center">
            <FolderOpen className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-[11px] text-muted-foreground">
              {query ? "No matches" : "Gallery empty"}
            </p>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 gap-1.5 p-2.5"
            role="listbox"
            aria-label="Gallery components"
          >
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
                <div className="p-1.5">
                  <p className="truncate text-[11px] font-medium">{component.name}</p>
                  <Badge variant="outline" className="mt-0.5 h-3.5 px-1 text-[11px]">
                    {component.mode}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Selected actions */}
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
              Load
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              aria-label={selected.isFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => handleFavorite(selected.id)}
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
              aria-label={confirmDeleteId === selected.id ? "Confirm delete" : "Delete component"}
              onClick={() => handleDelete(selected.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
