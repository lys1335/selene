"use client";

import { useState } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Code, Download, Image, Trash2, Save } from "lucide-react";

export function DesignPropertiesPanel() {
  const components = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const updateComponent = useDesignWorkspaceStore((s) => s.updateComponent);
  const removeComponent = useDesignWorkspaceStore((s) => s.removeComponent);
  const showCode = useDesignWorkspaceStore((s) => s.showCode);
  const toggleCode = useDesignWorkspaceStore((s) => s.toggleCode);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const component = components.find((c) => c.id === activeComponentId);

  if (!component) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
        Select a component to view properties
      </div>
    );
  }

  function handleNameChange(name: string) {
    if (component) {
      updateComponent(component.id, { name });
    }
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (component) {
      removeComponent(component.id);
    }
    setConfirmDelete(false);
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Name
          </label>
          <Input
            value={component.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Mode & Style */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Mode / Style
          </label>
          <div className="flex gap-2">
            <Badge variant="secondary">{component.mode}</Badge>
            <Badge variant="outline">{component.style}</Badge>
          </div>
        </div>

        {/* Prompt */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Original Prompt
          </label>
          <p className="text-sm text-muted-foreground">{component.prompt || "No prompt recorded"}</p>
        </div>

        {/* Code toggle */}
        <div className="space-y-1.5">
          <Button variant="outline" size="sm" onClick={toggleCode} className="w-full gap-2">
            <Code className="h-4 w-4" />
            {showCode ? "Hide Code" : "Show Code"}
          </Button>
          {showCode && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
              {component.code}
            </pre>
          )}
        </div>

        {/* Export buttons */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Export
          </label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" disabled>
              <Download className="h-3.5 w-3.5" />
              HTML
            </Button>
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" disabled>
              <Download className="h-3.5 w-3.5" />
              React
            </Button>
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" disabled>
              <Image className="h-3.5 w-3.5" />
              PNG
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Export buttons will be wired through the design tool flow.</p>
        </div>

        {/* Save to Gallery */}
        <Button variant="outline" size="sm" className="w-full gap-2" disabled>
          <Save className="h-4 w-4" />
          Save to Gallery
        </Button>

        {/* Delete */}
        <Button
          variant="destructive"
          size="sm"
          className="w-full gap-2"
          onClick={handleDelete}
          onBlur={() => setConfirmDelete(false)}
        >
          <Trash2 className="h-4 w-4" />
          {confirmDelete ? "Click again to confirm" : "Delete Component"}
        </Button>
      </div>
    </ScrollArea>
  );
}
