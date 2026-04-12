"use client";

/**
 * Design Project Browser
 *
 * Sidebar panel showing the detected project structure organized by type
 * (pages, components, layouts, styles). Clicking an entry casts it into
 * the design workspace preview.
 */

import { useState } from "react";
import { FileText, Layout, Paintbrush, Component, ChevronRight, ChevronDown, FolderOpen } from "lucide-react";
import type { ProjectEntry, ProjectStructure } from "@/lib/design/workspace/types";

interface DesignProjectBrowserProps {
  projectStructure: ProjectStructure | null;
  castFile: string | null;
  onSelectFile: (file: string, mode: "page" | "component" | "route") => void;
  frameworkType?: string;
  projectRoot?: string;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  entries: ProjectEntry[];
  castFile: string | null;
  mode: "page" | "component" | "route";
  onSelect: (file: string, mode: "page" | "component" | "route") => void;
}

function ProjectSection({ title, icon, entries, castFile, mode, onSelect }: SectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (entries.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {icon}
        <span>{title}</span>
        <span className="ml-auto text-[10px] opacity-60">{entries.length}</span>
      </button>
      {expanded && (
        <div className="ml-3 border-l border-border/50 pl-1">
          {entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => onSelect(entry.path, mode)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                castFile === entry.path
                  ? "bg-accent/20 text-accent font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              title={entry.path}
            >
              <FileText className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{entry.name}</span>
              {entry.route && (
                <span className="ml-auto text-[10px] opacity-50 truncate max-w-[80px]">
                  {entry.route}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DesignProjectBrowser({
  projectStructure,
  castFile,
  onSelectFile,
  frameworkType,
  projectRoot,
}: DesignProjectBrowserProps) {
  if (!projectStructure) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        <p>No project detected. Use the <code>detect</code> action to scan a synced folder.</p>
      </div>
    );
  }

  const totalEntries =
    projectStructure.pages.length +
    projectStructure.components.length +
    projectStructure.layouts.length +
    projectStructure.styles.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FolderOpen className="h-3.5 w-3.5 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {frameworkType ? frameworkType.charAt(0).toUpperCase() + frameworkType.slice(1) : "Project"}
          </p>
          {projectRoot && (
            <p className="truncate text-[10px] text-muted-foreground">{projectRoot}</p>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{totalEntries} files</span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        <ProjectSection
          title="Pages"
          icon={<FileText className="h-3 w-3" />}
          entries={projectStructure.pages}
          castFile={castFile}
          mode="page"
          onSelect={onSelectFile}
        />
        <ProjectSection
          title="Components"
          icon={<Component className="h-3 w-3" />}
          entries={projectStructure.components}
          castFile={castFile}
          mode="component"
          onSelect={onSelectFile}
        />
        <ProjectSection
          title="Layouts"
          icon={<Layout className="h-3 w-3" />}
          entries={projectStructure.layouts}
          castFile={castFile}
          mode="page"
          onSelect={onSelectFile}
        />
        <ProjectSection
          title="Styles"
          icon={<Paintbrush className="h-3 w-3" />}
          entries={projectStructure.styles}
          castFile={castFile}
          mode="component"
          onSelect={onSelectFile}
        />
      </div>
    </div>
  );
}
