"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useDesignWorkspaceStore } from "@/lib/design/workspace";
import { useShallow } from "zustand/react/shallow";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Code,
  Download,
  Image as ImageIcon,
  Film,
  Trash2,
  Save,
  Loader2,
  Check,
  X,
  Copy,
  Crosshair,
  ChevronDown,
  Settings2,
  History,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  requestDesignWorkspaceSettings,
  requestExport,
  requestSaveToGallery,
  requestUpdateDesignWorkspaceSettings,
  type ExportFormat,
} from "./design-api-client";
import { VersionsContent } from "./design-versions-content";
import { GalleryContent } from "./design-gallery-content";

type RightPanelTab = "properties" | "versions" | "gallery";

// ─── Helpers ──────────────────────────────────────────────────

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Derived selector hook ──────────────────────────────────

function useActiveComponent() {
  const components = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  return useMemo(
    () => components.find((c) => c.id === activeComponentId) ?? null,
    [components, activeComponentId],
  );
}

// ─── Component Selector (with ARIA + keyboard) ─────────────

function ComponentSelector() {
  const components = useDesignWorkspaceStore((s) => s.components);
  const activeComponentId = useDesignWorkspaceStore((s) => s.activeComponentId);
  const setActiveComponent = useDesignWorkspaceStore((s) => s.setActiveComponent);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const active = useActiveComponent();

  // Reset focused index when dropdown opens
  useEffect(() => {
    if (open) {
      const idx = components.findIndex((c) => c.id === activeComponentId);
      setFocusedIndex(idx >= 0 ? idx : 0);
    }
  }, [open, components, activeComponentId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, components.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < components.length) {
          setActiveComponent(components[focusedIndex].id);
          setOpen(false);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Home":
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedIndex(components.length - 1);
        break;
    }
  }

  // Scroll focused item into view
  useEffect(() => {
    if (open && listRef.current && focusedIndex >= 0) {
      const items = listRef.current.querySelectorAll("[role='option']");
      items[focusedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, focusedIndex]);

  if (components.length === 0) {
    return (
      <div className="px-3 py-2.5 text-xs text-muted-foreground">
        No components yet
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select component"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {active?.name || "Select component"}
          </div>
          {active && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Badge variant="secondary" className="px-1 py-0 text-[11px]">
                {active.mode}
              </Badge>
              <Badge variant="outline" className="px-1 py-0 text-[11px]">
                {active.style}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {formatTime(active.createdAt)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {components.length}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div
            ref={listRef}
            role="listbox"
            aria-label="Components"
            className="absolute left-0 right-0 top-full z-20 max-h-60 overflow-auto border-b border-border bg-background shadow-lg"
            onKeyDown={handleKeyDown}
          >
            {components.map((component, index) => (
              <button
                key={component.id}
                role="option"
                aria-selected={activeComponentId === component.id}
                onClick={() => {
                  setActiveComponent(component.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors",
                  activeComponentId === component.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50",
                  focusedIndex === index && "ring-2 ring-inset ring-primary",
                )}
              >
                <span className="truncate font-medium">{component.name}</span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                  {formatTime(component.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Properties Tab Content ──────────────────────────────────

function PropertiesContent() {
  const {
    updateComponent,
    removeComponent,
    showCode,
    toggleCode,
    selectedElement,
    setSelectedElement,
    config,
    updateConfig,
    lastValidation,
    lastCompileReport,
    history: workspaceHistory,
    setConfig,
  } = useDesignWorkspaceStore(
    useShallow((s) => ({
      updateComponent: s.updateComponent,
      removeComponent: s.removeComponent,
      showCode: s.showCode,
      toggleCode: s.toggleCode,
      selectedElement: s.selectedElement,
      setSelectedElement: s.setSelectedElement,
      config: s.config,
      updateConfig: s.updateConfig,
      lastValidation: s.lastValidation,
      lastCompileReport: s.lastCompileReport,
      history: s.history,
      setConfig: s.setConfig,
    })),
  );

  const component = useActiveComponent();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [exportResult, setExportResult] = useState<{
    format: ExportFormat;
    url?: string;
    code?: string;
    fileName?: string;
    error?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const timeoutIds = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    requestDesignWorkspaceSettings().then((result) => {
      if (!cancelled && result.success && result.data) {
        setConfig(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setConfig]);

  // Sync local name input with component name
  useEffect(() => {
    if (component) setNameValue(component.name);
  }, [component?.id, component?.name]);

  // Reset state when component changes
  useEffect(() => {
    setExportResult(null);
    setSaved(false);
    setCopySuccess(false);
    setConfirmDelete(false);
    setExportingFormat(null);
    for (const id of timeoutIds.current) clearTimeout(id);
    timeoutIds.current = [];
  }, [component?.id]);

  // Cleanup
  useEffect(() => {
    return () => {
      for (const id of timeoutIds.current) clearTimeout(id);
      clearTimeout(nameDebounceRef.current);
      clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
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
          setExportResult({ format, error: result.error || "Export failed" });
        }
      } catch (err) {
        setExportResult({
          format,
          error:
            err instanceof Error && err.name === "AbortError"
              ? "Export timed out. Try a simpler component or use HTML format."
              : "Export failed. Check if Puppeteer is available.",
        });
      } finally {
        setExportingFormat(null);
      }
    },
    [component, exportingFormat],
  );

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
        const id = setTimeout(() => setSaved(false), 2000);
        timeoutIds.current.push(id);
      }
    } catch (err) {
      console.warn("[design-properties] Save to gallery failed:", err);
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
      const id = setTimeout(() => setCopySuccess(false), 1500);
      timeoutIds.current.push(id);
    } catch {
      // Clipboard API may be unavailable
    }
  }, [component, exportResult]);

  const handleWorkspaceSettingChange = useCallback(async <K extends keyof typeof config>(key: K, value: (typeof config)[K]) => {
    updateConfig({ [key]: value });
    setSettingsSaving(true);
    const result = await requestUpdateDesignWorkspaceSettings({ [key]: value });
    setSettingsSaving(false);
    setSettingsMessage(result.success ? "Workspace settings saved." : result.error || "Failed to save workspace settings.");
    const id = setTimeout(() => setSettingsMessage(null), 2000);
    timeoutIds.current.push(id);
  }, [config, updateConfig]);

  if (!component) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        Select a component to view properties
      </div>
    );
  }

  // Debounced name change — 300ms delay
  function handleNameChange(value: string) {
    setNameValue(value);
    clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(() => {
      if (component) updateComponent(component.id, { name: value });
    }, 300);
  }

  // Timed delete confirm — auto-resets after 3s (keyboard-safe, no onBlur)
  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (component) removeComponent(component.id);
    setConfirmDelete(false);
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        {/* Inspector */}
        {selectedElement && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Crosshair className="h-3 w-3" />
                Selected Element
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[11px]"
                onClick={() => setSelectedElement(null)}
                aria-label="Deselect element"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-baseline gap-1">
                <span className="font-medium">&lt;{selectedElement.tagName}&gt;</span>
                {selectedElement.id && (
                  <span className="text-blue-600 dark:text-blue-400">#{selectedElement.id}</span>
                )}
              </div>
              {selectedElement.className && (
                <div className="flex flex-wrap gap-0.5">
                  {selectedElement.className
                    .trim()
                    .split(/\s+/)
                    .slice(0, 6)
                    .map((cls, i) => (
                      <Badge key={i} variant="secondary" className="px-1 py-0 text-[11px]">
                        .{cls}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
              {(["width", "height", "padding", "margin"] as const).map((prop) => (
                <div key={prop} className="flex justify-between">
                  <span className="text-muted-foreground capitalize">{prop}</span>
                  <span className="font-mono">{selectedElement.computedStyles[prop]}</span>
                </div>
              ))}
            </div>
            <div className="space-y-0.5 border-t border-border pt-1.5 text-[11px]">
              {(["display", "position", "fontSize"] as const).map((prop) => (
                <div key={prop} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {prop.replace(/([A-Z])/g, " $1").trim()}
                  </span>
                  <span className="font-mono">{selectedElement.computedStyles[prop]}</span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Color</span>
                <span className="flex items-center gap-1 font-mono">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm border border-border"
                    style={{ backgroundColor: selectedElement.computedStyles.color }}
                  />
                  {selectedElement.computedStyles.color}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">BG</span>
                <span className="flex items-center gap-1 font-mono">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm border border-border"
                    style={{ backgroundColor: selectedElement.computedStyles.backgroundColor }}
                  />
                  {selectedElement.computedStyles.backgroundColor}
                </span>
              </div>
            </div>
            <pre className="overflow-auto rounded bg-muted p-1 font-mono text-[11px] text-foreground">
              {selectedElement.selector}
            </pre>
          </div>
        )}

        {/* Name (debounced) */}
        <div className="space-y-1">
          <label
            htmlFor="component-name"
            className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Name
          </label>
          <Input
            id="component-name"
            value={nameValue}
            onChange={(e) => handleNameChange(e.target.value)}
            className="h-7 text-xs"
          />
        </div>

        {/* Style badges */}
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
            Tailwind
          </Badge>
          <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
            {component.style}
          </Badge>
        </div>

        {/* Prompt (collapsed) */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Prompt
          </label>
          <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
            {component.prompt || "No prompt recorded"}
          </p>
        </div>

        {/* Code */}
        <div className="space-y-1">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleCode}
              className="h-7 flex-1 gap-1.5 text-xs"
            >
              <Code className="h-3.5 w-3.5" />
              {showCode ? "Hide" : "Code"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyCode}
              className="h-7 w-7 p-0"
              aria-label="Copy code"
            >
              {copySuccess ? (
                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
          {showCode && (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
              {component.code}
            </pre>
          )}
        </div>

        {/* Workspace settings */}
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Workspace Settings
            </label>
            {settingsSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-terminal-muted" /> : null}
          </div>
          <div className="grid gap-2 text-[11px]">
            <label className="flex items-center justify-between gap-3 rounded border border-border bg-background/70 px-2 py-1.5">
              <span>Hook preset</span>
              <select
                value={config.postEditHooksPreset}
                onChange={(e) => void handleWorkspaceSettingChange("postEditHooksPreset", e.target.value as typeof config.postEditHooksPreset)}
                className="rounded border border-border bg-background px-2 py-1 text-[11px]"
              >
                <option value="off">off</option>
                <option value="fast">fast</option>
                <option value="strict">strict</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded border border-border bg-background/70 px-2 py-1.5">
              <span>Strict typecheck</span>
              <input
                type="checkbox"
                checked={config.typecheckStrictMode}
                onChange={(e) => void handleWorkspaceSettingChange("typecheckStrictMode", e.target.checked)}
                className="size-4 accent-terminal-green"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded border border-border bg-background/70 px-2 py-1.5">
              <span>JSX validation</span>
              <input
                type="checkbox"
                checked={config.jsxValidationEnabled}
                onChange={(e) => void handleWorkspaceSettingChange("jsxValidationEnabled", e.target.checked)}
                className="size-4 accent-terminal-green"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded border border-border bg-background/70 px-2 py-1.5">
              <span>Import validation</span>
              <input
                type="checkbox"
                checked={config.postEditImportValidationEnabled}
                onChange={(e) => void handleWorkspaceSettingChange("postEditImportValidationEnabled", e.target.checked)}
                className="size-4 accent-terminal-green"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded border border-border bg-background/70 px-2 py-1.5">
              <span>Strict preview check</span>
              <input
                type="checkbox"
                checked={config.postEditPreviewEnabled}
                onChange={(e) => void handleWorkspaceSettingChange("postEditPreviewEnabled", e.target.checked)}
                className="size-4 accent-terminal-green"
              />
            </label>
          </div>
          {settingsMessage ? <div className="text-[11px] text-muted-foreground">{settingsMessage}</div> : null}
        </div>

        {(lastValidation || lastCompileReport || workspaceHistory) && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5 text-[11px]">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Workspace Diagnostics
            </label>
            {lastValidation ? (
              <div>
                <div className="font-medium">Post-edit checks: {lastValidation.passed ? "passed" : "issues found"}</div>
                <div className="text-muted-foreground">{lastValidation.checks.length} checks</div>
              </div>
            ) : null}
            {lastCompileReport ? (
              <div>
                <div className="font-medium">Last compile: {lastCompileReport.errors.length === 0 ? "ok" : "failed"}</div>
                {lastCompileReport.dependencyCheck.missingPackages.length > 0 ? (
                  <div className="text-red-600">Missing packages: {lastCompileReport.dependencyCheck.missingPackages.join(", ")}</div>
                ) : null}
              </div>
            ) : null}
            {workspaceHistory?.actions?.length ? (
              <div className="text-muted-foreground">Session history: {workspaceHistory.actions.length} actions</div>
            ) : null}
          </div>
        )}

        {/* Export */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Export
          </label>
          <div className="grid grid-cols-4 gap-1">
            {([
              { fmt: "html" as const, icon: Download, label: "HTML" },
              { fmt: "react" as const, icon: Download, label: "React" },
              { fmt: "png" as const, icon: ImageIcon, label: "PNG" },
              { fmt: "video" as const, icon: Film, label: "MP4" },
            ] as const).map(({ fmt, icon: Icon, label }) => (
              <Button
                key={fmt}
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[11px]"
                disabled={exportingFormat !== null}
                onClick={() => handleExport(fmt)}
              >
                {exportingFormat === fmt ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
                {label}
              </Button>
            ))}
          </div>

          {exportResult && !exportResult.error && (
            <div className="rounded bg-emerald-50 p-1.5 text-[11px] dark:bg-emerald-950/30">
              <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                {exportResult.fileName || exportResult.format}
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
                  className="mt-0.5 truncate text-emerald-600 underline dark:text-emerald-400"
                >
                  Download
                </button>
              )}
              {exportResult.url && !exportResult.code && (
                <a
                  href={exportResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 block truncate text-emerald-600 underline dark:text-emerald-400"
                >
                  Open file
                </a>
              )}
            </div>
          )}
          {exportResult?.error && (
            <div className="rounded bg-destructive/10 p-1.5 text-[11px]">
              <div className="flex items-center gap-1 text-destructive">
                <X className="h-3 w-3" />
                {exportResult.error}
              </div>
            </div>
          )}
        </div>

        {/* Actions row */}
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1.5 text-xs"
            onClick={handleSaveToGallery}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saved ? (
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {saved ? "Saved" : "Gallery"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={handleDelete}
          >
            <Trash2 className="h-3 w-3" />
            {confirmDelete ? "Confirm" : "Delete"}
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

// ─── Tab definitions ────────────────────────────────────────

const TABS: { id: RightPanelTab; icon: typeof Settings2; label: string }[] = [
  { id: "properties", icon: Settings2, label: "Properties" },
  { id: "versions", icon: History, label: "Versions" },
  { id: "gallery", icon: LayoutGrid, label: "Gallery" },
];

// ─── Main Panel ─────────────────────────────────────────────

export function DesignPropertiesPanel() {
  const [activeTab, setActiveTab] = useState<RightPanelTab>("properties");
  const [collapsed, setCollapsed] = useState(false);

  // Keyboard navigation for tabs
  function handleTabKeyDown(e: React.KeyboardEvent, index: number) {
    let nextIndex = index;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (index + 1) % TABS.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = TABS.length - 1;
    } else {
      return;
    }
    setActiveTab(TABS[nextIndex].id);
    // Focus the next tab button
    const tablist = (e.currentTarget as HTMLElement).parentElement;
    const buttons = tablist?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    buttons?.[nextIndex]?.focus();
  }

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-l border-border bg-background py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setCollapsed(false)}
          aria-label="Expand panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-border">
      {/* Header: collapse toggle + component selector */}
      <div className="flex items-center border-b border-border">
        <div className="flex-1">
          <ComponentSelector />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mr-1 h-7 w-7 shrink-0 p-0"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Tab bar (ARIA tablist) */}
      <div className="flex border-b border-border" role="tablist" aria-label="Panel sections">
        {TABS.map(({ id, icon: Icon, label }, index) => (
          <button
            key={id}
            role="tab"
            id={`panel-tab-${id}`}
            aria-selected={activeTab === id}
            aria-controls={`panel-tabpanel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setActiveTab(id)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors",
              activeTab === id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div
        className="flex-1 overflow-hidden"
        role="tabpanel"
        id={`panel-tabpanel-${activeTab}`}
        aria-labelledby={`panel-tab-${activeTab}`}
      >
        {activeTab === "properties" && <PropertiesContent />}
        {activeTab === "versions" && <VersionsContent />}
        {activeTab === "gallery" && <GalleryContent />}
      </div>
    </div>
  );
}
