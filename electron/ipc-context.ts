import type { BrowserWindow } from "electron";

/**
 * Shared context passed to every IPC sub-handler registrar.
 * Kept in a separate file to avoid circular imports between
 * ipc-handlers.ts and the sub-handler files.
 */
export interface IpcHandlerContext {
  mainWindow: () => BrowserWindow | null;
  isDev: boolean;
  dataDir: string;
  mediaDir: string;
  userDataPath: string;
  userModelsDir: string;
  prodServerPort: number;
  prodUseHttps?: boolean;
}
