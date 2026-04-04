/**
 * Type declarations for Electron API exposed via preload script.
 * ElectronAPI is defined in lib/electron/types.ts (the canonical source).
 * This file augments the global Window interface for renderer-process access.
 */

import type { ElectronAPI } from "@/lib/electron/types";

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export { };
