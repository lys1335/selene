"use client";

import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DesignVersionHistory() {
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const snapshots = useDesignWorkspaceStore((s) => s.snapshots);
  const takeSnapshot = useDesignWorkspaceStore((s) => s.takeSnapshot);
  const restoreSnapshot = useDesignWorkspaceStore((s) => s.restoreSnapshot);

  const componentSnapshots = snapshots.filter(
    (s) => s.componentId === activeComponentId,
  );

  if (!activeComponentId) {
    return (
      <div className="flex h-full flex-col">
        <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Version History
        </div>
        <div className="flex flex-1 items-center justify-center px-3 text-sm text-muted-foreground">
          Select a component
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Version History
        </span>
        <Button variant="ghost" size="sm" onClick={() => takeSnapshot()} className="h-7 gap-1 px-2">
          <Camera className="h-3.5 w-3.5" />
          <span className="text-xs">Snapshot</span>
        </Button>
      </div>
      {componentSnapshots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3 text-sm text-muted-foreground">
          No snapshots yet
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 px-2 pb-2">
            {[...componentSnapshots].reverse().map((snapshot) => (
              <button
                key={snapshot.id}
                onClick={() => restoreSnapshot(snapshot.id)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <span className="truncate">
                  {snapshot.label || "Snapshot"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTimestamp(snapshot.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
