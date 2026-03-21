"use client";

import { usePermissionListener } from "@/lib/hooks/use-permission-listener";

/**
 * Thin client component that subscribes to permission-related IPC events from
 * the Electron main process. Renders nothing — purely a side-effect wrapper.
 *
 * Mounted in the root layout alongside `<OverlaySessionNavigator />`.
 */
export function PermissionListener() {
  usePermissionListener();
  return null;
}
