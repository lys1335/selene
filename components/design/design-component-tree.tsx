"use client";

import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function DesignComponentTree() {
  const components = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const setActiveComponent = useDesignWorkspaceStore((s) => s.setActiveComponent);

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Components
      </div>
      {components.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3 text-sm text-muted-foreground">
          No components yet
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 px-2 pb-2">
            {components.map((component) => (
              <button
                key={component.id}
                onClick={() => setActiveComponent(component.id)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  activeComponentId === component.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-medium">{component.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTime(component.createdAt)}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {component.mode}
                  </Badge>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {component.style}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
