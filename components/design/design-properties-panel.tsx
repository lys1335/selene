"use client";

import { useState, useCallback } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Code,
  Download,
  Image,
  Film,
  Trash2,
  Save,
  Loader2,
  Check,
  X,
  Copy,
} from "lucide-react";

type ExportFormat = "html" | "react" | "png" | "video";

async function requestExport(code: string, format: ExportFormat, componentName: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("/api/design/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, format, componentName }),
      signal: controller.signal,
    });
    return response.json() as Promise<{
      success: boolean;
      data?: { url?: string; code?: string; fileName?: string; renderedHtml?: string };
      error?: string;
    }>;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestSaveToGallery(component: {
  name: string;
  code: string;
  mode: string;
  style: string;
  prompt: string;
}) {
  const response = await fetch("/api/design/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save",
      name: component.name,
      code: component.code,
      mode: component.mode,
      style: component.style,
      prompt: component.prompt,
    }),
  });
  return response.json() as Promise<{ success: boolean; error?: string }>;
}

export function DesignPropertiesPanel() {
  const components = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const updateComponent = useDesignWorkspaceStore((s) => s.updateComponent);
  const removeComponent = useDesignWorkspaceStore((s) => s.removeComponent);
  const showCode = useDesignWorkspaceStore((s) => s.showCode);
  const toggleCode = useDesignWorkspaceStore((s) => s.toggleCode);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [exportResult, setExportResult] = useState<{ format: ExportFormat; url?: string; code?: string; fileName?: string; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const component = components.find((c) => c.id === activeComponentId);

  const handleExport = useCallback(async (format: ExportFormat) => {
    if (!component || exportingFormat) return;
    setExportingFormat(format);
    setExportResult(null);
    try {
      const result = await requestExport(component.code, format, component.name);
      if (result.success && result.data) {
        setExportResult({
          format,
          url: result.data.url,
          code: result.data.code,
          fileName: result.data.fileName,
        });
      } else {
        setExportResult({
          format,
          error: result.error || "Export failed",
        });
      }
    } catch (err) {
      setExportResult({
        format,
        error: err instanceof Error && err.name === "AbortError"
          ? "Export timed out. Try a simpler component or use HTML format."
          : "Export failed. Check if Puppeteer is available.",
      });
    } finally {
      setExportingFormat(null);
    }
  }, [component, exportingFormat]);

  const handleSaveToGallery = useCallback(async () => {
    if (!component || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const result = await requestSaveToGallery({
        name: component.name,
        code: component.code,
        mode: component.mode,
        style: component.style,
        prompt: component.prompt,
      });
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }, [component, saving]);

  const handleCopyCode = useCallback(async () => {
    if (!component) return;
    try {
      const textToCopy = exportResult?.code || component.code;
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts
    }
  }, [component, exportResult]);

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
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={toggleCode} className="flex-1 gap-2">
              <Code className="h-4 w-4" />
              {showCode ? "Hide Code" : "Show Code"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyCode} className="gap-1.5">
              {copySuccess ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
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
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={exportingFormat !== null}
              onClick={() => handleExport("html")}
            >
              {exportingFormat === "html" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              HTML
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={exportingFormat !== null}
              onClick={() => handleExport("react")}
            >
              {exportingFormat === "react" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              React
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={exportingFormat !== null}
              onClick={() => handleExport("png")}
            >
              {exportingFormat === "png" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Image className="h-3.5 w-3.5" />}
              PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={exportingFormat !== null}
              onClick={() => handleExport("video")}
            >
              {exportingFormat === "video" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
              MP4
            </Button>
          </div>

          {/* Export result */}
          {exportResult && !exportResult.error && (
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 p-2 text-xs">
              <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                Exported as {exportResult.fileName || exportResult.format}
              </div>
              {exportResult.code && (
                <button
                  onClick={() => {
                    const blob = new Blob([exportResult.code!], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = exportResult.fileName || `design.${exportResult.format}`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                  }}
                  className="mt-1 block truncate text-emerald-600 dark:text-emerald-400 dark:text-emerald-400 underline hover:text-emerald-700 dark:hover:text-emerald-300"
                >
                  Download {exportResult.fileName}
                </button>
              )}
              {exportResult.url && !exportResult.code && (
                <a
                  href={exportResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-emerald-600 dark:text-emerald-400 dark:text-emerald-400 underline"
                >
                  Open exported file
                </a>
              )}
            </div>
          )}
          {exportResult?.error && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs">
              <div className="flex items-center gap-1 text-destructive">
                <X className="h-3 w-3" />
                {exportResult.error}
              </div>
            </div>
          )}
        </div>

        {/* Save to Gallery */}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={handleSaveToGallery}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? "Saved!" : "Save to Gallery"}
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
