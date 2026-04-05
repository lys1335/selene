"use client";

import { useState, useEffect } from "react";

/**
 * Cached settings object returned by GET /api/settings.
 * We use Record<string, unknown> because the full AppSettings type lives in a
 * server-only module (settings-manager.ts) that imports Node `fs`.
 */
export type CachedSettings = Record<string, unknown>;

// ── Module-level cache — shared across all component instances ──────────────
let settingsCache: CachedSettings | null = null;
let settingsPromise: Promise<CachedSettings> | null = null;
let settingsGeneration = 0;
const listeners = new Set<(s: CachedSettings) => void>();

export async function fetchSettingsOnce(): Promise<CachedSettings> {
  if (settingsCache) return settingsCache;
  if (settingsPromise) return settingsPromise;

  const generation = settingsGeneration;
  const promise = fetch("/api/settings")
    .then((r) => {
      if (!r.ok) throw new Error(`Settings fetch failed (${r.status})`);
      return r.json();
    })
    .then((data: CachedSettings) => {
      // Only write cache if no invalidation happened since this request started
      if (settingsGeneration === generation) {
        settingsCache = data;
        listeners.forEach((l) => l(data));
      }
      return data;
    })
    .finally(() => {
      if (settingsPromise === promise) {
        settingsPromise = null;
      }
    });

  settingsPromise = promise;
  return settingsPromise;
}

/**
 * Call after a successful PUT/PATCH to /api/settings so the next useSettings()
 * consumer gets fresh data.
 */
export async function invalidateSettingsCache(): Promise<void> {
  settingsCache = null;
  settingsPromise = null;
  settingsGeneration++; // bump generation so stale responses are ignored
  try {
    const fresh = await fetchSettingsOnce();
    listeners.forEach((l) => l(fresh));
  } catch {
    // best-effort — if the refetch fails, consumers will just keep their current data
  }
}

/**
 * Shared hook that fetches GET /api/settings exactly once per page load.
 * All components that call useSettings() share the same in-flight request and
 * cached result. Always subscribes to invalidation updates.
 */
export function useSettings() {
  const [settings, setSettings] = useState<CachedSettings | null>(settingsCache);
  const [isLoading, setIsLoading] = useState(!settingsCache);

  useEffect(() => {
    let mounted = true;
    const listener = (s: CachedSettings) => {
      if (!mounted) return;
      setSettings(s);
      setIsLoading(false);
    };
    listeners.add(listener);

    if (settingsCache) {
      setSettings(settingsCache);
      setIsLoading(false);
      return () => {
        mounted = false;
        listeners.delete(listener);
      };
    }

    fetchSettingsOnce()
      .then((data) => {
        if (mounted) {
          setSettings(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  return { settings, isLoading };
}
