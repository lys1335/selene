"use client";

import { useState } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { DesignPreviewFrame } from "./design-preview-frame";
import { DesignComponentTree } from "./design-component-tree";
import { DesignVersionHistory } from "./design-version-history";
import { DesignPropertiesPanel } from "./design-properties-panel";
import { DesignGallery } from "./design-gallery";
import { DesignWorkspaceBridge } from "./design-workspace-bridge";
import { Button } from "@/components/ui/button";
import { History, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

type LeftBottomTab = "history" | "gallery";

interface DesignWorkspaceProps {
  /** Current chat session ID — isolates workspace state per conversation */
  sessionId?: string;
}

export function DesignWorkspace({ sessionId }: DesignWorkspaceProps) {
  const isOpen = useDesignWorkspaceStore((s) => s.isOpen);
  const addComponent = useDesignWorkspaceStore((s) => s.addComponent);
  const [leftBottomTab, setLeftBottomTab] = useState<LeftBottomTab>("history");

  function handleLoadFromGallery(component: {
    id: string;
    name: string;
    code: string;
    mode: string;
    style: string;
    prompt: string;
  }) {
    addComponent({
      id: crypto.randomUUID(),
      name: component.name,
      code: component.code,
      mode: component.mode as "html" | "tailwind",
      style: component.style as "apple-glass" | "default",
      prompt: component.prompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <>
      {/* Bridge must always be mounted to listen for "open" events */}
      <DesignWorkspaceBridge sessionId={sessionId} />
      {!isOpen ? null : (
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* Left panel */}
        <div className="flex w-60 flex-col border-r border-border">
          <div className="flex-1 overflow-hidden">
            <DesignComponentTree />
          </div>
          <div className="h-px bg-border" />
          {/* Tab switcher */}
          <div className="flex border-b border-border">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "flex-1 gap-1.5 rounded-none text-xs",
                leftBottomTab === "history" && "bg-muted"
              )}
              onClick={() => setLeftBottomTab("history")}
            >
              <History className="h-3 w-3" />
              History
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "flex-1 gap-1.5 rounded-none text-xs",
                leftBottomTab === "gallery" && "bg-muted"
              )}
              onClick={() => setLeftBottomTab("gallery")}
            >
              <LayoutGrid className="h-3 w-3" />
              Gallery
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            {leftBottomTab === "history" ? (
              <DesignVersionHistory />
            ) : (
              <DesignGallery onLoadComponent={handleLoadFromGallery} />
            )}
          </div>
        </div>

        {/* Center panel */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <DesignPreviewFrame />
        </div>

        {/* Right panel */}
        <div className="w-80 overflow-hidden border-l border-border">
          <DesignPropertiesPanel />
        </div>
      </div>
      )}
    </>
  );
}
