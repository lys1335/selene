"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

interface GalleryComponent {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  code: string;
  framework: string;
  category: string;
  tags: string[];
  styleTags: string[];
  previewUrl: string | null;
  mode: string;
  style: string;
  useCount: number;
  lastUsedAt: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DesignGalleryProps {
  onLoadComponent?: (component: GalleryComponent) => void;
  className?: string;
}

type FilterMode = "all" | "favorites";

async function fetchGalleryApi(
  action: string,
  params: Record<string, unknown> = {}
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const response = await fetch("/api/design/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  return response.json();
}

export function DesignGallery({ onLoadComponent, className }: DesignGalleryProps) {
  const [components, setComponents] = useState<GalleryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadComponents = useCallback(async (searchQuery?: string, favoritesOnly?: boolean) => {
    setLoading(true);
    try {
      const result = await fetchGalleryApi("search", {
        query: searchQuery || undefined,
        favoritesOnly: favoritesOnly === true,
        limit: 60,
      });
      if (result.success && result.data?.components) {
        setComponents(result.data.components as unknown as GalleryComponent[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + filter changes trigger immediately
  useEffect(() => {
    loadComponents(query, filter === "favorites");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query changes go through debounce below
  }, [filter, loadComponents]);

  function handleSearchChange(value: string) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      loadComponents(value, filter === "favorites");
    }, 300);
  }

  async function handleFavorite(id: string) {
    await fetchGalleryApi("favorite", { componentId: id });
    loadComponents(query, filter === "favorites");
  }

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    await fetchGalleryApi("delete", { componentId: id });
    setConfirmDeleteId(null);
    if (selectedId === id) setSelectedId(null);
    loadComponents(query, filter === "favorites");
  }

  function handleLoad(component: GalleryComponent) {
    onLoadComponent?.(component);
  }

  const selected = components.find((c) => c.id === selectedId);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search gallery..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex gap-1">
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setFilter("all")}
          >
            <Clock className="mr-1 h-3 w-3" />
            Recent
          </Button>
          <Button
            variant={filter === "favorites" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setFilter("favorites")}
          >
            <Star className="mr-1 h-3 w-3" />
            Favorites
          </Button>
        </div>
      </div>

      {/* Grid */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : components.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {query ? "No components match your search" : "Gallery is empty"}
            </p>
            <p className="text-xs text-muted-foreground/70">
              Generate components and save them here for reuse.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3">
            {components.map((component) => (
              <button
                key={component.id}
                type="button"
                onClick={() => setSelectedId(selectedId === component.id ? null : component.id)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
                  selectedId === component.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
                )}
              >
                {/* Preview */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                  {component.previewUrl ? (
                    <img
                      src={component.previewUrl}
                      alt={component.name}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Code className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                  )}
                  {component.isFavorite && (
                    <div className="absolute right-1 top-1">
                      <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="space-y-1 p-2">
                  <p className="truncate text-xs font-medium">{component.name}</p>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {component.mode}
                    </Badge>
                    {component.useCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        used {component.useCount}×
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Detail / Actions for selected */}
      {selected && (
        <div className="space-y-2 border-t border-border p-3">
          <p className="truncate text-xs font-medium">{selected.name}</p>
          {selected.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{selected.description}</p>
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              onClick={() => handleLoad(selected)}
            >
              <ArrowDownToLine className="h-3 w-3" />
              Load
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleFavorite(selected.id)}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  selected.isFavorite && "fill-amber-400 text-amber-400"
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 w-7 p-0",
                confirmDeleteId === selected.id && "text-destructive"
              )}
              onClick={() => handleDelete(selected.id)}
              onBlur={() => setConfirmDeleteId(null)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
