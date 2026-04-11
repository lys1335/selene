import {
  deleteDesignComponent,
  findDesignComponentForScope,
  getDesignComponent,
  incrementDesignUseCount,
  listDesignComponents,
  listDesignComponentsForScope,
  saveDesignComponent,
  toggleDesignFavorite,
} from "./queries";
import type { DesignComponentRow, GallerySearchOpts, NewDesignComponent, ScopedDesignListOpts } from "./types";

export interface DesignGalleryItem extends DesignComponentRow {
  previewUrl: string | null;
}

interface SaveDesignComponentInput extends NewDesignComponent {}

function toPreviewUrl(previewPath: string | null): string | null {
  if (!previewPath) {
    return null;
  }

  return `/api/media/${previewPath.replace(/^\/+/, "")}`;
}

function toDesignGalleryItem(row: DesignComponentRow): DesignGalleryItem {
  return {
    ...row,
    previewUrl: toPreviewUrl(row.previewPath),
  };
}

export async function saveDesignComponentRecord(
  component: SaveDesignComponentInput
): Promise<DesignGalleryItem> {
  const row = await saveDesignComponent(component);
  return toDesignGalleryItem(row);
}

export async function listGalleryComponents(
  opts: GallerySearchOpts & { search?: string }
): Promise<DesignGalleryItem[]> {
  const rows = await listDesignComponents(opts);
  return rows.map(toDesignGalleryItem);
}

export async function listWorkspaceDesigns(
  opts: ScopedDesignListOpts
): Promise<DesignGalleryItem[]> {
  const rows = await listDesignComponentsForScope(opts);
  return rows.map(toDesignGalleryItem);
}

export async function findWorkspaceDesign(
  opts: { id: string; userId?: string; sessionId?: string }
): Promise<DesignGalleryItem | null> {
  const row = await findDesignComponentForScope(opts);
  return row ? toDesignGalleryItem(row) : null;
}

export async function getGalleryComponentForUser(
  userId: string,
  id: string
): Promise<DesignGalleryItem | null> {
  const row = await getDesignComponent(userId, id);
  return row ? toDesignGalleryItem(row) : null;
}

export async function toggleGalleryFavoriteForUser(
  userId: string,
  id: string
): Promise<DesignGalleryItem | null> {
  const newValue = await toggleDesignFavorite(userId, id);
  if (newValue === null) return null;
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
