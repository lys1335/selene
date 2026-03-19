"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { getElectronAPI } from "@/lib/electron/types";
import { resilientFetch } from "@/lib/utils/resilient-fetch";
import { useSessionSyncStore } from "@/lib/stores/session-sync-store";
import type { SessionInfo } from "@/components/chat/chat-sidebar/types";

interface OverlaySessionUpdateDetail {
  sessionId: string;
  characterId: string;
}

interface OverlayComposeInjectDetail {
  transcript: string;
  screenshotUrl?: string;
  screenshotUrls?: string[];
  characterId?: string;
  sessionId?: string;
}

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
  const searchParams = useSearchParams();
  const currentSessionId = searchParams?.get("sessionId") ?? null;
  const [pendingComposePayload, setPendingComposePayload] = useState<OverlayComposeInjectDetail | null>(null);

  const dispatchComposeInject = useCallback((payload: OverlayComposeInjectDetail) => {
    window.dispatchEvent(new CustomEvent<OverlayComposeInjectDetail>("overlay:compose-inject", {
      detail: payload,
    }));
  }, []);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;

    const handleSessionUpdated = async (payload: unknown) => {
      const data = payload as {
        sessionId?: string;
        characterId?: string;
      } | undefined;
      if (!data?.sessionId || !data?.characterId) return;

      const targetPath = `/chat/${data.characterId}`;
      const targetUrl = `${targetPath}?sessionId=${data.sessionId}`;

      // Hydrate the session store before navigation so assistant-ui thread
      // lookups do not point at a session the in-memory list does not know yet.
      try {
        const { data: sessionPayload } = await resilientFetch<{
          session?: SessionInfo;
          messages?: unknown[];
        }>(`/api/sessions/${data.sessionId}`, {
          retries: 0,
          headers: { "Cache-Control": "no-cache" },
        });

        const session = sessionPayload?.session;
        if (session) {
          useSessionSyncStore.getState().setSession({
            id: session.id,
            title: session.title,
            characterId: session.characterId ?? session.metadata?.characterId ?? data.characterId,
            updatedAt: session.updatedAt,
            lastMessageAt: session.lastMessageAt,
            messageCount: session.messageCount,
            totalTokenCount: session.totalTokenCount,
            channelType: session.channelType ?? session.metadata?.channelType,
            hasActiveRun: session.hasActiveRun,
          });
        }
      } catch {}

      window.dispatchEvent(new CustomEvent<OverlaySessionUpdateDetail>("overlay:session-updated", {
        detail: {
          sessionId: data.sessionId,
          characterId: data.characterId,
        },
      }));

      if (!pathname?.startsWith(targetPath)) {
        router.push(targetUrl);
        return;
      }

      // Same character page, different session: switch to the overlay session.
      if (currentSessionId !== data.sessionId) {
        router.replace(targetUrl);
      }
    };

    api.ipc.on("overlay:session-updated", handleSessionUpdated);

    return () => {
      api?.ipc?.removeAllListeners?.("overlay:session-updated");
    };
  }, [currentSessionId, router, pathname]);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.ipc?.on) return;

    const handleComposeInject = (payload: unknown) => {
      const data = payload as OverlayComposeInjectDetail | undefined;
      if (!data?.transcript) return;

      if (!data.characterId) {
        dispatchComposeInject(data);
        return;
      }

      const targetPath = `/chat/${data.characterId}`;
      const targetUrl = data.sessionId ? `${targetPath}?sessionId=${data.sessionId}` : targetPath;
      setPendingComposePayload(data);

      if (pathname === targetPath && (!data.sessionId || currentSessionId === data.sessionId)) {
        dispatchComposeInject(data);
        setPendingComposePayload(null);
        return;
      }

      router.push(targetUrl);
    };

    api.ipc.on("overlay:compose-inject", handleComposeInject);

    return () => {
      api?.ipc?.removeAllListeners?.("overlay:compose-inject");
    };
  }, [currentSessionId, dispatchComposeInject, pathname, router]);

  useEffect(() => {
    if (!pendingComposePayload?.characterId) return;

    const targetPath = `/chat/${pendingComposePayload.characterId}`;
    if (pathname !== targetPath) return;
    if (pendingComposePayload.sessionId && currentSessionId !== pendingComposePayload.sessionId) return;

    const rafId = window.requestAnimationFrame(() => {
      dispatchComposeInject(pendingComposePayload);
      setPendingComposePayload(null);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [currentSessionId, dispatchComposeInject, pathname, pendingComposePayload]);

  return null;
}
