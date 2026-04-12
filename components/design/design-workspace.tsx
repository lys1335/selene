"use client";

import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { DesignPreviewFrame } from "./design-preview-frame";
import { DesignProjectBrowser } from "./design-project-browser";
import { DesignPropertiesPanel } from "./design-properties-panel";
import { DesignWorkspaceBridge } from "./design-workspace-bridge";

interface DesignWorkspaceProps {
  /** Current chat session ID — isolates workspace state per conversation */
  sessionId?: string;
}

export function DesignWorkspace({ sessionId }: DesignWorkspaceProps) {
  const isOpen = useDesignWorkspaceStore((s) => s.isOpen);
  const projectContext = useDesignWorkspaceStore((s) => s.projectContext);

  return (
    <>
      {/* Bridge must always be mounted to listen for "open" events */}
      <DesignWorkspaceBridge sessionId={sessionId} />
      {!isOpen ? null : (
        <div className="flex h-full w-full overflow-hidden bg-background">
          {/* Left sidebar — project browser (only when a project is detected) */}
          {projectContext?.projectStructure && (
            <aside className="w-56 flex-shrink-0 border-r border-border overflow-hidden">
              <DesignProjectBrowser
                projectStructure={projectContext.projectStructure}
                castFile={projectContext.castFile}
                onSelectFile={(file, mode) => {
                  // Dispatch cast action via custom event for the bridge/tool system
                  const event = new CustomEvent("design-workspace-cast-request", {
                    detail: { targetFile: file, castMode: mode },
                  });
                  window.dispatchEvent(event);
                }}
                frameworkType={projectContext.framework.type}
                projectRoot={projectContext.projectRoot}
              />
            </aside>
          )}

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
