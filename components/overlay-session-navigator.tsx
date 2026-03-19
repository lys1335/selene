"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getElectronAPI } from "@/lib/electron/types";

/**
 * Global listener that navigates to the correct chat session when the overlay
 * sends a message in Direct mode. Mounted in the root layout so it works
 * regardless of which page the user is on (agent picker, settings, etc.).
 *
 * This is separate from OverlaySyncBridge (which is scoped to an active chat
 * session) because the overlay creates/reuses sessions independently.
 */
export function OverlaySessionNavigator() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;

    const handleSessionUpdated = (payload: unknown) => {
      const data = payload as {
        sessionId?: string;
        characterId?: string;
      } | undefined;
      if (!data?.sessionId || !data?.characterId) return;

      // If we're already on the correct session page, just refresh messages
      // (handled by OverlaySyncBridge in chat-interface). Otherwise navigate.
      const targetPath = `/chat/${data.characterId}`;
      if (!pathname?.startsWith(targetPath)) {
        router.push(`${targetPath}?sessionId=${data.sessionId}`);
      }
    };

    api.ipc.on("overlay:session-updated", handleSessionUpdated);

    return () => {
      api?.ipc?.removeAllListeners?.("overlay:session-updated");
    };
  }, [router, pathname]);

  return null;
}
