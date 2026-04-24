"use client";

import { useDesignWorkspaceStore } from "@/lib/design/workspace/store";
import { useShallow } from "zustand/react/shallow";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function VersionsContent() {
  const { activeComponentId, snapshots, takeSnapshot, restoreSnapshot } =
    useDesignWorkspaceStore(
      useShallow((s) => ({
        activeComponentId: s.activeComponentId,
        snapshots: s.snapshots,
        takeSnapshot: s.takeSnapshot,
        restoreSnapshot: s.restoreSnapshot,
      })),
    );

  const componentSnapshots = snapshots.filter((s) => s.componentId === activeComponentId);

  if (!activeComponentId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a component first
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Snapshots
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => takeSnapshot()}
          className="h-6 gap-1 px-2 text-[11px]"
        >
          <Camera className="h-3 w-3" />
          Take
        </Button>
      </div>

      {componentSnapshots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3 text-xs text-muted-foreground">
          No snapshots yet
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-2">
            {[...componentSnapshots].reverse().map((snapshot) => (
              <button
                key={snapshot.id}
                onClick={() => restoreSnapshot(snapshot.id)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50"
              >
                <span className="truncate">{snapshot.label || "Snapshot"}</span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
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
