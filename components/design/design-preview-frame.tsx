"use client";

import type { ReactNode } from "react";
import { useDesignWorkspaceStore, DESIGN_BREAKPOINTS } from "@/lib/design/workspace";
import { Button } from "@/components/ui/button";
import { Monitor, Tablet, Smartphone } from "lucide-react";

const BREAKPOINT_ICONS: Record<string, ReactNode> = {
  mobile: <Smartphone className="h-4 w-4" />,
  tablet: <Tablet className="h-4 w-4" />,
  desktop: <Monitor className="h-4 w-4" />,
};

export function DesignPreviewFrame() {
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const previewHtml = useDesignWorkspaceStore((s) => s.previewHtml);
  const selectedBreakpoint = useDesignWorkspaceStore((s) => s.selectedBreakpoint);
  const setBreakpoint = useDesignWorkspaceStore((s) => s.setBreakpoint);

  if (!activeComponentId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select or create a component to preview
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Breakpoint toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        {DESIGN_BREAKPOINTS.map((bp) => (
          <Button
            key={bp.name}
            variant={selectedBreakpoint.name === bp.name ? "default" : "ghost"}
            size="sm"
            onClick={() => setBreakpoint(bp)}
            className="gap-1.5"
          >
            {BREAKPOINT_ICONS[bp.name]}
            <span className="capitalize">{bp.name}</span>
            <span className="text-xs opacity-60">{bp.width}px</span>
          </Button>
        ))}
      </div>

      {/* Preview area */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-muted/30 p-6">
        <div
          className="bg-background shadow-lg transition-all duration-200"
          style={{
            width: selectedBreakpoint.width,
            height: selectedBreakpoint.height,
          }}
        >
          <iframe
            srcDoc={previewHtml}
            sandbox="allow-scripts"
            className="h-full w-full border-0"
            title="Design preview"
          />
        </div>
      </div>
    </div>
  );
}
