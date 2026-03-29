"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2Icon,
  XCircleIcon,
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
  MonitorIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { getElectronAPI } from "@/lib/electron/types";

interface GhostOsStatusData {
  installed: boolean;
  version?: string;
  visionModelInstalled: boolean;
  permissions: {
    accessibility: boolean;
    screenRecording: boolean;
    inputMonitoring: boolean;
  };
  binaryPath?: string;
}

/**
 * Ghost OS settings section — shows installation status, permissions,
 * vision model state, and setup/download actions.
 */
export function GhostOsSection() {
  const [status, setStatus] = useState<GhostOsStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRunning, setSetupRunning] = useState(false);
  const [visionDownloading, setVisionDownloading] = useState(false);
  const [visionProgress, setVisionProgress] = useState(0);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.ghostOs) {
        const result = await electronAPI.ghostOs.getStatus();
        setStatus(result);
      } else {
        // Fallback to API route for non-Electron
        const response = await fetch("/api/ghost-os/status");
        if (response.ok) {
          setStatus(await response.json());
        }
      }
    } catch (error) {
      console.error("[GhostOS] Status check failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Listen for vision model download progress
  useEffect(() => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.model?.onProgress) return;

    const handleProgress = (data: { modelId: string; status: string; progress?: number; error?: string }) => {
      if (data.modelId !== "ghostos-showui-2b") return;
      if (data.status === "downloading" && data.progress !== undefined) {
        setVisionProgress(data.progress);
      } else if (data.status === "completed") {
        setVisionDownloading(false);
        setVisionProgress(100);
        toast.success("Vision model downloaded");
        checkStatus();
      } else if (data.status === "error") {
        setVisionDownloading(false);
        setVisionProgress(0);
        toast.error(`Vision model download failed: ${data.error || "Unknown error"}`);
      }
    };

    electronAPI.model.onProgress(handleProgress);
    return () => {
      electronAPI.model.removeProgressListener();
    };
  }, [checkStatus]);

  const handleSetup = async () => {
    setSetupRunning(true);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.ghostOs) {
        const result = await electronAPI.ghostOs.runSetup();
        if (result.success) {
          toast.success("Ghost OS setup completed");
        } else {
          toast.error(`Setup failed: ${result.stderr}`);
        }
      } else {
        const response = await fetch("/api/ghost-os/setup", { method: "POST" });
        const result = await response.json();
        if (result.success) {
          toast.success("Ghost OS setup completed");
        } else {
          toast.error(`Setup failed: ${result.stderr}`);
        }
      }
      await checkStatus();
    } catch (error) {
      toast.error("Setup failed");
      console.error("[GhostOS] Setup error:", error);
    } finally {
      setSetupRunning(false);
    }
  };

  const handleDownloadVision = async () => {
    setVisionDownloading(true);
    setVisionProgress(0);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.ghostOs) {
        const result = await electronAPI.ghostOs.downloadVisionModel();
        if (!result.success) {
          toast.error(`Download failed: ${result.error || "Unknown error"}`);
          setVisionDownloading(false);
        }
      } else {
        toast.error("Vision model download requires the desktop app");
        setVisionDownloading(false);
      }
    } catch (error) {
      toast.error("Download failed");
      setVisionDownloading(false);
      console.error("[GhostOS] Vision download error:", error);
    }
  };

  const StatusIcon = ({ ok }: { ok: boolean }) =>
    ok ? (
      <CheckCircle2Icon className="h-4 w-4 text-green-500" />
    ) : (
      <XCircleIcon className="h-4 w-4 text-red-400" />
    );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Checking Ghost OS status...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorIcon className="h-5 w-5" />
          <h3 className="text-sm font-medium">Ghost OS</h3>
          <span className="text-xs text-muted-foreground">macOS Desktop Automation</span>
        </div>
        <Button variant="ghost" size="sm" onClick={checkStatus} disabled={loading}>
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Installation Status */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <StatusIcon ok={status?.installed ?? false} />
            <span>Installation</span>
          </div>
          {status?.installed ? (
            <span className="text-xs text-muted-foreground">
              v{status.version || "unknown"} — {status.binaryPath}
            </span>
          ) : (
            <a
              href="https://github.com/nicholaschenai/ghost-os"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
            >
              Install via Homebrew
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Permissions */}
        {status?.installed && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <StatusIcon ok={status.permissions.accessibility} />
                <span>Accessibility</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <StatusIcon ok={status.permissions.screenRecording} />
                <span>Screen Recording</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <StatusIcon ok={status.permissions.inputMonitoring} />
                <span>Input Monitoring</span>
                <span className="text-xs text-muted-foreground">(required for learning mode)</span>
              </div>
            </div>
          </>
        )}

        {/* Vision Model */}
        {status?.installed && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <StatusIcon ok={status.visionModelInstalled} />
              <span>ShowUI-2B Vision Model</span>
              <span className="text-xs text-muted-foreground">(~3 GB)</span>
            </div>
            {!status.visionModelInstalled && !visionDownloading && (
              <Button variant="outline" size="sm" onClick={handleDownloadVision}>
                <DownloadIcon className="h-3.5 w-3.5 mr-1" />
                Download
              </Button>
            )}
            {visionDownloading && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${visionProgress}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{visionProgress}%</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {status?.installed && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSetup}
            disabled={setupRunning}
          >
            {setupRunning ? (
              <Loader2Icon className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : null}
            Run Setup
          </Button>
        </div>
      )}

      {!status?.installed && (
        <p className="text-xs text-muted-foreground">
          Ghost OS enables AI agents to control any macOS application using the accessibility tree.
          Install it to let agents automate desktop workflows.
        </p>
      )}
    </div>
  );
}
