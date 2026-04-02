"use client";

import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { DesignPreviewFrame } from "./design-preview-frame";
import { DesignComponentTree } from "./design-component-tree";
import { DesignVersionHistory } from "./design-version-history";
import { DesignPropertiesPanel } from "./design-properties-panel";
import { DesignWorkspaceBridge } from "./design-workspace-bridge";

export function DesignWorkspace() {
  const isOpen = useDesignWorkspaceStore((s) => s.isOpen);

  if (!isOpen) return null;

  return (
    <>
      <DesignWorkspaceBridge />
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* Left panel */}
        <div className="flex w-60 flex-col border-r border-border">
          <div className="flex-1 overflow-hidden">
            <DesignComponentTree />
          </div>
          <div className="h-px bg-border" />
          <div className="flex-1 overflow-hidden">
            <DesignVersionHistory />
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
    </>
  );
}
