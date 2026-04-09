/**
 * Design workspace API client — shared by gallery, properties, export, and
 * workspace settings flows.
 */

import {
  getDesignWorkspaceConfigFromSettingsRecord,
  toDesignWorkspaceSettingsPatch,
  type DesignWorkspaceConfig,
} from "@/lib/design/workspace/config";

// ─── Types ───────────────────────────────────────────────────

export type ExportFormat = "html" | "react" | "png" | "video";

/** Shape returned by the gallery search API. Matches DesignGalleryItem on the server. */
export interface GalleryComponent {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  code: string;
  framework: string;
  category: string;
  tags: string[];
  styleTags: string[];
  previewUrl: string | null;
  mode: string;
  style: string;
  useCount: number;
  lastUsedAt: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Export API ──────────────────────────────────────────────

export async function requestExport(
  code: string,
  format: ExportFormat,
  componentName: string,
): Promise<{
  success: boolean;
  data?: { url?: string; code?: string; fileName?: string; renderedHtml?: string };
  error?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("/api/design/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, format, componentName }),
      signal: controller.signal,
    });
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Gallery save ───────────────────────────────────────────

export async function requestSaveToGallery(component: {
  name: string;
  code: string;
  mode: string;
  style: string;
  prompt: string;
}): Promise<{ success: boolean; error?: string }> {
  const response = await fetch("/api/design/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save",
      name: component.name,
      code: component.code,
      mode: component.mode,
      style: component.style,
      prompt: component.prompt,
    }),
  });
  return response.json();
}

// ─── Workspace settings ─────────────────────────────────────

export async function requestDesignWorkspaceSettings(): Promise<{
  success: boolean;
  data?: DesignWorkspaceConfig;
  error?: string;
}> {
  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Settings fetch failed (${response.status})`);
    }

    const settings = (await response.json()) as Record<string, unknown>;
    return {
      success: true,
      data: getDesignWorkspaceConfigFromSettingsRecord(settings),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load design workspace settings.",
    };
  }
}

export async function requestUpdateDesignWorkspaceSettings(
  patch: Partial<DesignWorkspaceConfig>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toDesignWorkspaceSettingsPatch(patch)),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: string[] }
        | null;
      const detailText = payload?.details?.join(" ");
      throw new Error(payload?.error || detailText || `Settings update failed (${response.status})`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save design workspace settings.",
    };
  }
}

// ─── Generic gallery API call ───────────────────────────────

export async function fetchGalleryApi(
  action: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const response = await fetch("/api/design/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
    signal,
  });
  return response.json();
}
