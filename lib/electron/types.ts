/**
 * Type definitions for the Electron API exposed via contextBridge.
 * This allows type-safe access to Electron functionality from the renderer process.
 */

export interface ElectronWindowAPI {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  isFullScreen: () => Promise<boolean>;
  onFullscreenChanged: (callback: (isFullScreen: boolean) => void) => () => void;
}

export interface ElectronAppAPI {
  getVersion: () => Promise<string>;
  getName: () => Promise<string>;
}

export interface ElectronShellAPI {
  openExternal: (url: string) => Promise<void>;
}

export interface ElectronIpcAPI {
  send: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeAllListeners: (channel: string) => void;
}

export interface ModelDownloadProgress {
  modelId: string;
  status: "downloading" | "completed" | "error";
  progress?: number;
  totalFiles?: number;
  downloadedFiles?: number;
  file?: string;
  error?: string;
}

export interface ElectronModelAPI {
  getModelsDir: () => Promise<string>;
  checkExists: (modelId: string) => Promise<boolean>;
  download: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  onProgress: (callback: (data: ModelDownloadProgress) => void) => void;
  removeProgressListener: () => void;
  checkFileExists: (opts: { modelId: string; filename: string }) => Promise<boolean>;
  downloadFile: (opts: { modelId: string; repo: string; filename: string }) => Promise<{ success: boolean; error?: string }>;
  parakeetGetStatus: (modelId?: string) => Promise<{
    installed: boolean;
    running: boolean;
    modelId: string | null;
    modelDir: string | null;
    wsBinary: string | null;
    wsAvailable: boolean;
    cpuThreads: number;
    baseDir: string;
  }>;
  parakeetResolvePaths: (modelId?: string) => Promise<{
    success: boolean;
    error?: string;
    modelId?: string;
    modelDir?: string;
    wsBinary?: string | null;
    modelInstalled?: boolean;
    wsAvailable?: boolean;
  }>;
  parakeetDownloadModel: (modelId?: string) => Promise<{
    success: boolean;
    error?: string;
    modelId?: string;
    modelDir?: string;
    wsBinary?: string | null;
  }>;
}

export interface ElectronBrowserSessionAPI {
  open: (sessionId: string) => Promise<{ success: boolean; reused?: boolean; error?: string }>;
  close: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  isOpen: (sessionId: string) => Promise<{ open: boolean }>;
  saveRecording: (options?: { defaultPath?: string }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean }>;
}

export interface ElectronLogsAPI {
  subscribe: () => void;
  unsubscribe: () => void;
  getBuffer: () => Promise<{ timestamp: string; level: string; message: string }[]>;
  clear: () => void;
  onEntry: (callback: (entry: { timestamp: string; level: string; message: string }) => void) => () => void;
  onCritical: (callback: (data: { type: string; message: string }) => void) => () => void;
  removeListeners: () => void;
}

export interface ScreenCaptureResult {
  success: boolean;
  imageUrl?: string;
  relativePath?: string;
  width?: number;
  height?: number;
  error?: string;
  permissionStatus: "granted" | "denied" | "restricted" | "not-determined" | "unknown";
}

export interface ElectronScreenCaptureAPI {
  onCaptured: (callback: (result: ScreenCaptureResult) => void) => (() => void) | undefined;
  capture: () => Promise<ScreenCaptureResult>;
  register: (accelerator: string, enabled?: boolean) => Promise<{ success: boolean; accelerator: string; error?: string; disabled?: boolean }>;
  registerFromSettings: () => Promise<{ success: boolean; accelerator: string; error?: string; disabled?: boolean }>;
  getRegistered: () => Promise<{ accelerator: string }>;
  clear: () => Promise<{ success: boolean }>;
  checkPermission: () => Promise<{ status: ScreenCaptureResult["permissionStatus"] }>;
}

export interface ScreenCaptureMetadata {
  capturedAt: string;
  activeWindowTitle?: string;
  activeAppName?: string;
  activeUrl?: string;
  displayIndex?: number;
  originalResolution?: { width: number; height: number };
  captureMode: "fullscreen" | "active-window" | "region" | "display";
}

export interface UnifiedCaptureTriggerPayload {
  mode: "voice+screen" | "voice-only" | "screen-only";
  screenshot?: {
    url: string;
    filePath: string;
  };
  metadata?: ScreenCaptureMetadata;
  startVoice: boolean;
  screenshotError?: string;
  traceId: string;
}

export interface ElectronUnifiedCaptureAPI {
  onTriggered: (callback: (payload: UnifiedCaptureTriggerPayload) => void) => (() => void) | undefined;
  trigger: (mode?: "voice+screen" | "voice-only" | "screen-only") => Promise<UnifiedCaptureTriggerPayload>;
  register: (accelerator: string, enabled?: boolean) => Promise<{ success: boolean; accelerator: string; error?: string; disabled?: boolean }>;
  registerFromSettings: () => Promise<{ success: boolean; accelerator: string; error?: string; disabled?: boolean }>;
  getRegistered: () => Promise<{ accelerator: string }>;
  clear: () => Promise<{ success: boolean }>;
}

export interface ElectronAPI {
  platform: NodeJS.Platform;
  isElectron: boolean;
  window: ElectronWindowAPI;
  app: ElectronAppAPI;
  shell: ElectronShellAPI;
  ipc: ElectronIpcAPI;
  model: ElectronModelAPI;
  logs?: ElectronLogsAPI;
  browserSession?: ElectronBrowserSessionAPI;
  screenCapture?: ElectronScreenCaptureAPI;
  unifiedCapture?: ElectronUnifiedCaptureAPI;
}

/**
 * Check if the app is running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && "electronAPI" in window;
}

/**
 * Get the Electron API if available
 */
export function getElectronAPI(): ElectronAPI | null {
  if (isElectron()) {
    return (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
  }
  return null;
}

/**
 * Open an external URL in the default browser
 * Works both in Electron and regular browser environments
 */
export async function openExternalUrl(url: string): Promise<void> {
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    await electronAPI.shell.openExternal(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// Note: Window.electronAPI is declared in electron/preload.ts
// This file only provides type definitions for use in the renderer process
