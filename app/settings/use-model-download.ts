"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

export interface ModelDownloadState {
  downloading: string | null;
  downloadProgress: number;
  downloadError: string | null;
}

export interface ModelDownloadActions {
  setDownloading: (id: string | null) => void;
  setDownloadProgress: (progress: number) => void;
  setDownloadError: (error: string | null) => void;
  setModelDownloaded: (modelId: string) => void;
}

export interface UseModelDownloadReturn extends ModelDownloadState, ModelDownloadActions {
  modelStatus: Record<string, boolean>;
  setModelStatus: Dispatch<SetStateAction<Record<string, boolean>>>;
  /**
   * Attach the standard progress listener and return a cleanup callback.
   * Wire this up before issuing a download call, then call the returned
   * cleanup after the download promise settles.
   */
  attachProgressListener: (
    onProgress: (cb: (data: { modelId: string; status: string; progress?: number; error?: string }) => void) => void,
    removeProgressListener: (() => void) | undefined,
    modelId: string,
  ) => () => void;
}

/**
 * Shared state and helpers for Electron model download flows.
 * Used by LocalEmbeddingModelSelector and WhisperModelSelector.
 */
export function useModelDownload(): UseModelDownloadReturn {
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function setModelDownloaded(modelId: string) {
    setModelStatus((prev) => ({ ...prev, [modelId]: true }));
  }

  function attachProgressListener(
    onProgress: (cb: (data: { modelId: string; status: string; progress?: number; error?: string }) => void) => void,
    removeProgressListener: (() => void) | undefined,
    modelId: string,
  ): () => void {
    onProgress((data) => {
      if (data.modelId !== modelId) return;
      if (data.progress !== undefined) {
        setDownloadProgress(data.progress);
      }
      if (data.status === "completed") {
        setDownloading(null);
        setModelDownloaded(modelId);
      }
      if (data.status === "error") {
        setDownloading(null);
        setDownloadError(data.error || "Download failed");
      }
    });
    return () => removeProgressListener?.();
  }

  return {
    modelStatus,
    setModelStatus,
    downloading,
    setDownloading,
    downloadProgress,
    setDownloadProgress,
    downloadError,
    setDownloadError,
    setModelDownloaded,
    attachProgressListener,
  };
}
