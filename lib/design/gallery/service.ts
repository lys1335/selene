import {
  deleteDesignComponent,
  findDesignComponentForScope,
  getDesignComponent,
  incrementDesignUseCount,
  listDesignComponents,
  listDesignComponentSummariesForScope,
  listDesignComponentsForScope,
  saveDesignComponent,
  toggleDesignFavorite,
} from "./queries";
import type {
  DesignComponentRow,
  DesignComponentSummaryRow,
  GallerySearchOpts,
  NewDesignComponent,
  ScopedDesignListOpts,
} from "./types";

export interface DesignGalleryItem extends DesignComponentRow {
  previewUrl: string | null;
}

/**
 * Metadata-only item returned by `listWorkspaceDesignSummaries`. Mirrors
 * `DesignGalleryItem` but omits `code` / `prompt` / `userId` — those must be
 * fetched on demand via `getGalleryComponentForUser` when a user opens the
 * component.
 */
export interface DesignGallerySummaryItem extends DesignComponentSummaryRow {
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

function toDesignGallerySummary(row: DesignComponentSummaryRow): DesignGallerySummaryItem {
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

/**
 * Metadata-only variant of `listWorkspaceDesigns`. Returns one row per
 * component but without `code` / `prompt`, so the initial gallery payload
 * stays small even for users with large libraries. Clients hydrate the full
 * row via `getGalleryComponentForUser` when the user opens a component.
 */
export async function listWorkspaceDesignSummaries(
  opts: ScopedDesignListOpts
): Promise<DesignGallerySummaryItem[]> {
  const rows = await listDesignComponentSummariesForScope(opts);
  return rows.map(toDesignGallerySummary);
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
