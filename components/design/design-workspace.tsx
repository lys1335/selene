"use client";

import { useDesignWorkspaceStore } from "@/lib/design/workspace/store";
import { DesignPreviewFrame } from "./design-preview-frame";
import { DesignPropertiesPanel } from "./design-properties-panel";
import { DesignWorkspaceBridge } from "./design-workspace-bridge";

interface DesignWorkspaceProps {
  /** Current chat session ID — isolates workspace state per conversation */
  sessionId?: string;
}

export function DesignWorkspace({ sessionId }: DesignWorkspaceProps) {
  const isOpen = useDesignWorkspaceStore((s) => s.isOpen);

  return (
    <>
      {/* Bridge must always be mounted to listen for "open" events */}
      <DesignWorkspaceBridge sessionId={sessionId} />
      {!isOpen ? null : (
        <div className="flex h-full w-full overflow-hidden bg-background">
          {/* Preview */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <DesignPreviewFrame />
          </div>

          {/* Right panel — unified properties, components, versions, gallery */}
          <div className="overflow-hidden">
            <DesignPropertiesPanel />
          </div>
        </div>
      )}
    </>
  );
}
