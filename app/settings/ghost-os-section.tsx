"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2Icon,
  XCircleIcon,
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
  MonitorIcon,
  ExternalLinkIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("settings.ghostOs");
  const [status, setStatus] = useState<GhostOsStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [setupRunning, setSetupRunning] = useState(false);
  const [visionDownloading, setVisionDownloading] = useState(false);
  const [visionProgress, setVisionProgress] = useState(0);
  const mountedRef = useRef(true);
  // Guard against running setup and vision download simultaneously
  const operationInProgress = setupRunning || visionDownloading;

  const checkStatus = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setStatusError(null);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.ghostOs) {
        const result = await electronAPI.ghostOs.getStatus();
        if (mountedRef.current) setStatus(result);
      } else {
        // Fallback to API route for non-Electron
        const response = await fetch("/api/ghost-os/status");
        if (response.ok) {
          if (mountedRef.current) setStatus(await response.json());
        } else {
          if (mountedRef.current) {
            setStatusError(t("statusCheckFailed", { code: response.status }));
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("[GhostOS] Status check failed:", error);
      if (mountedRef.current) setStatusError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [checkStatus]);

  // Listen for vision model download progress
  useEffect(() => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.model?.onProgress) return;

    const handleProgress = (data: { modelId: string; status: string; progress?: number; error?: string }) => {
      if (data.modelId !== "ghostos-showui-2b") return;
      if (!mountedRef.current) return;

      if (data.status === "downloading" && data.progress !== undefined) {
        setVisionProgress(data.progress);
      } else if (data.status === "completed") {
        setVisionDownloading(false);
        setVisionProgress(100);
        toast.success(t("visionModelDownloaded"));
        checkStatus();
      } else if (data.status === "error") {
        setVisionDownloading(false);
        setVisionProgress(0);
        toast.error(t("visionDownloadFailed", { error: data.error || "Unknown error" }));
      }
    };

    electronAPI.model.onProgress(handleProgress);
    return () => {
      // Note: ideally onProgress would return a cleanup fn. For now we accept the
      // shared-channel limitation. The component guards on modelId so stray events
      // from other downloads are filtered out.
      electronAPI.model.removeProgressListener();
    };
  }, [checkStatus]);

  const handleSetup = async () => {
    if (operationInProgress) return;
    setSetupRunning(true);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.ghostOs) {
        const result = await electronAPI.ghostOs.runSetup();
        if (result.success) {
          toast.success(t("setupCompleted"));
        } else {
          toast.error(t("setupFailed", { error: result.stderr }));
        }
      } else {
        const response = await fetch("/api/ghost-os/setup", { method: "POST" });
        const result = await response.json();
        if (result.success) {
          toast.success(t("setupCompleted"));
        } else {
          toast.error(t("setupFailed", { error: result.stderr }));
        }
      }
      await checkStatus();
    } catch (error) {
      toast.error(t("setupFailedGeneric"));
      console.error("[GhostOS] Setup error:", error);
    } finally {
      if (mountedRef.current) setSetupRunning(false);
    }
  };

  const handleDownloadVision = async () => {
    if (operationInProgress) return;
    setVisionDownloading(true);
    setVisionProgress(0);
    try {
      const electronAPI = getElectronAPI();
      if (electronAPI?.ghostOs) {
        const result = await electronAPI.ghostOs.downloadVisionModel();
        if (!result.success) {
          // Only reset here on IPC-level failure; progress listener handles
          // success/error from the streaming path to avoid double-clear flicker.
          if (mountedRef.current) {
            setVisionDownloading(false);
            toast.error(t("downloadFailedWithError", { error: result.error || "Unknown error" }));
          }
        }
        // Don't reset visionDownloading on success — the progress listener's
        // "completed" event handles that, preventing a flash of the download
        // button between the invoke return and the progress event.
      } else {
        toast.error(t("visionRequiresDesktop"));
        setVisionDownloading(false);
      }
    } catch (error) {
      toast.error(t("downloadFailed"));
      console.error("[GhostOS] Vision download error:", error);
      if (mountedRef.current) setVisionDownloading(false);
    }
  };

  const StatusIcon = ({ ok }: { ok: boolean }) =>
    ok ? (
      <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
    ) : (
      <XCircleIcon className="h-4 w-4 text-red-500" />
    );

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-terminal-muted">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        {t("checkingStatus")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorIcon className="h-5 w-5" />
          <h3 className="font-mono text-sm font-semibold text-terminal-dark">{t("heading")}</h3>
          <span className="text-xs text-terminal-muted">{t("subtitle")}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={checkStatus}
          disabled={loading}
          aria-label={t("refreshAriaLabel")}
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Error state — distinct from "not installed" */}
      {statusError && !status && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{t("statusCheckFailedLabel")}</span>
          </div>
          <p className="text-xs text-terminal-muted">{statusError}</p>
          <Button variant="outline" size="sm" onClick={checkStatus}>
            {t("retry")}
          </Button>
        </div>
      )}

      {/* Installation Status */}
      {(status || !statusError) && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <StatusIcon ok={status?.installed ?? false} />
              <span>{t("installation")}</span>
            </div>
            {status?.installed ? (
              <span className="text-xs text-terminal-muted">
                v{status.version || "unknown"} — {status.binaryPath}
              </span>
            ) : (
              <a
                href="https://github.com/ghostwright/ghost-os"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
              >
                {t("installViaHomebrew")}
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
                  <span>{t("accessibility")}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <StatusIcon ok={status.permissions.screenRecording} />
                  <span>{t("screenRecording")}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <StatusIcon ok={status.permissions.inputMonitoring} />
                  <span>{t("inputMonitoring")}</span>
                  <span className="text-xs text-terminal-muted">{t("inputMonitoringHint")}</span>
                </div>
              </div>
            </>
          )}

          {/* Vision Model */}
          {status?.installed && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <StatusIcon ok={status.visionModelInstalled} />
                <span>{t("visionModel")}</span>
                <span className="text-xs text-terminal-muted">{t("visionModelSize")}</span>
              </div>
              {!status.visionModelInstalled && !visionDownloading && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadVision}
                  disabled={operationInProgress}
                >
                  <DownloadIcon className="h-3.5 w-3.5 mr-1" />
                  {t("download")}
                </Button>
              )}
              {visionDownloading && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${visionProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-terminal-muted">{visionProgress}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {status?.installed && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSetup}
            disabled={operationInProgress}
          >
            {setupRunning ? (
              <Loader2Icon className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : null}
            {t("runSetup")}
          </Button>
        </div>
      )}

      {!status?.installed && !statusError && (
        <p className="text-xs text-terminal-muted">
          {t("description")}
        </p>
      )}
    </div>
  );
}
