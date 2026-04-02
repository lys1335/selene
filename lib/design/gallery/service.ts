import { exportDesignAsset, type DesignExportMode } from "@/lib/design/workspace/export";
import {
  deleteDesignComponent,
  getDesignComponent,
  incrementDesignUseCount,
  listDesignComponents,
  saveDesignComponent,
  toggleDesignFavorite,
  updateDesignComponent,
} from "./queries";
import type { DesignComponentRow, GallerySearchOpts, NewDesignComponent } from "./types";

export interface DesignGalleryItem extends DesignComponentRow {
  previewUrl: string | null;
}

export interface SaveDesignComponentWithPreviewInput extends NewDesignComponent {
  previewWidth?: number;
  previewHeight?: number;
  previewScale?: number;
}

export interface SaveDesignComponentWithPreviewResult {
  component: DesignGalleryItem;
  previewGenerated: boolean;
}

function toPreviewUrl(previewPath: string | null): string | null {
  if (!previewPath) {
    return null;
  }

  return `/api/media/${previewPath.replace(/^\/+/, "")}`;
}

function normalizeMode(mode?: string): DesignExportMode | undefined {
  return mode === "html" || mode === "tailwind" ? mode : undefined;
}

export function toDesignGalleryItem(row: DesignComponentRow): DesignGalleryItem {
  return {
    ...row,
    previewUrl: toPreviewUrl(row.previewPath),
  };
}

async function generateGalleryPreview(component: SaveDesignComponentWithPreviewInput): Promise<string | null> {
  try {
    const result = await exportDesignAsset({
      code: component.code,
      format: "png",
      mode: normalizeMode(component.mode),
      componentName: component.name,
      sessionId: component.sessionId || `design-gallery-${component.userId}`,
      width: component.previewWidth ?? 1200,
      height: component.previewHeight ?? 900,
      scale: component.previewScale ?? 1,
    });

    return result.localPath ?? null;
  } catch (error) {
    console.warn("[design/gallery] Preview generation failed — saving without thumbnail:", error);
    return null;
  }
}

export async function saveDesignComponentWithPreview(
  component: SaveDesignComponentWithPreviewInput
): Promise<SaveDesignComponentWithPreviewResult> {
  const previewPath = component.previewPath ?? await generateGalleryPreview(component);
  const row = await saveDesignComponent({
    ...component,
    previewPath: previewPath ?? component.previewPath,
  });

  return {
    component: toDesignGalleryItem(row),
    previewGenerated: Boolean(previewPath),
  };
}

export async function listGalleryComponents(
  opts: GallerySearchOpts & { search?: string }
): Promise<DesignGalleryItem[]> {
  const rows = await listDesignComponents(opts);
  return rows.map(toDesignGalleryItem);
}

export async function getGalleryComponentForUser(
  userId: string,
  id: string
): Promise<DesignGalleryItem | null> {
  const row = await getDesignComponent(userId, id);
  return row ? toDesignGalleryItem(row) : null;
}

export async function updateGalleryComponentForUser(
  userId: string,
  id: string,
  updates: Partial<NewDesignComponent>
): Promise<DesignGalleryItem | null> {
  const row = await updateDesignComponent(userId, id, updates);
  return row ? toDesignGalleryItem(row) : null;
}

export async function toggleGalleryFavoriteForUser(
  userId: string,
  id: string
): Promise<DesignGalleryItem | null> {
  await toggleDesignFavorite(userId, id);
  const row = await getDesignComponent(userId, id);
  return row ? toDesignGalleryItem(row) : null;
}

export async function markGalleryComponentUsed(
  userId: string,
  id: string
): Promise<DesignGalleryItem | null> {
  await incrementDesignUseCount(userId, id);
  const row = await getDesignComponent(userId, id);
  return row ? toDesignGalleryItem(row) : null;
}

export async function deleteGalleryComponentForUser(userId: string, id: string): Promise<boolean> {
  return deleteDesignComponent(userId, id);
}
