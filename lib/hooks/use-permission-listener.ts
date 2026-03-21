"use client";

import { useEffect } from "react";
import { getElectronAPI } from "@/lib/electron/types";
import { showPermissionToast } from "@/lib/electron/permission-toast";

/**
 * Listens for `permission:screen-required` IPC events from the Electron main
 * process and shows an actionable toast prompting the user to grant Screen
 * Recording permission.
 *
 * Mount this hook once at the app root (via `<PermissionListener />`) so the
 * toast fires regardless of which page or route is active.
 */
export function usePermissionListener(): void {
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.permissions?.onScreenPermissionRequired) return;

    return api.permissions.onScreenPermissionRequired(() => {
      showPermissionToast("screen");
    });
  }, []);
}
