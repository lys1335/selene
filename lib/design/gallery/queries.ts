import { db } from "@/lib/db/sqlite-client";
import { designComponents } from "@/lib/db/schema/design-gallery";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import type { NewDesignComponent, DesignComponentRow, GallerySearchOpts } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a raw DB row into the application-facing shape. */
function toRow(row: typeof designComponents.$inferSelect): DesignComponentRow {
  return {
    ...row,
    tags: safeParseTags(row.tags),
    styleTags: safeParseTags(row.styleTags),
    isFavorite: Boolean(row.isFavorite),
  };
}

function safeParseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Save a new component to the gallery. */
export async function saveDesignComponent(
  component: NewDesignComponent
): Promise<DesignComponentRow> {
  const id = component.id ?? crypto.randomUUID();
  const ts = now();

  const [inserted] = await db
    .insert(designComponents)
    .values({
      id,
      userId: component.userId,
      characterId: component.characterId ?? null,
      sessionId: component.sessionId ?? null,
      projectId: component.projectId ?? null,
      name: component.name,
      description: component.description ?? null,
      prompt: component.prompt,
      code: component.code,
      framework: component.framework ?? "html-css",
      category: component.category ?? "general",
      tags: JSON.stringify(component.tags ?? []),
      styleTags: JSON.stringify(component.styleTags ?? []),
      previewPath: component.previewPath ?? null,
      mode: component.mode ?? "tailwind",
      style: component.style ?? "default",
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();

  return toRow(inserted);
}

/** Get a single component by ID, scoped to the owning user. */
export async function getDesignComponent(
  userId: string,
  id: string
): Promise<DesignComponentRow | null> {
  const row = await db.query.designComponents.findFirst({
    where: and(eq(designComponents.userId, userId), eq(designComponents.id, id)),
  });
  return row ? toRow(row) : null;
}

/**
 * Resolve a component for internal tools when user scope may be unavailable.
 * Falls back to session scoping so the active chat can still recover persisted work.
 */
export async function findDesignComponentForScope(opts: {
  id: string;
  userId?: string;
  sessionId?: string;
}): Promise<DesignComponentRow | null> {
  const conditions: SQL[] = [eq(designComponents.id, opts.id)];

  if (opts.userId) {
    conditions.push(eq(designComponents.userId, opts.userId));
  } else if (opts.sessionId) {
    conditions.push(eq(designComponents.sessionId, opts.sessionId));
  } else {
    return null;
  }

  const row = await db.query.designComponents.findFirst({
    where: and(...conditions),
  });

  return row ? toRow(row) : null;
}

/**
 * List persisted components for a tool session.
 * Uses user scope when available, otherwise falls back to session scope.
 */
export async function listDesignComponentsForScope(opts: {
  userId?: string;
  sessionId?: string;
  limit?: number;
}): Promise<DesignComponentRow[]> {
  const conditions: SQL[] = [];

  if (opts.userId) {
    conditions.push(eq(designComponents.userId, opts.userId));
  } else if (opts.sessionId) {
    conditions.push(eq(designComponents.sessionId, opts.sessionId));
  } else {
    return [];
  }

  if (opts.sessionId) {
    conditions.push(eq(designComponents.sessionId, opts.sessionId));
  }

  const rows = await db
    .select()
    .from(designComponents)
    .where(and(...conditions))
    .orderBy(desc(designComponents.updatedAt))
    .limit(opts.limit ?? 50);

  return rows.map(toRow);
}

/** List components for a user with optional filters. */
export async function listDesignComponents(opts: GallerySearchOpts & {
  search?: string;
}): Promise<DesignComponentRow[]> {
  const search = opts.search ?? opts.query;
  const conditions: SQL[] = [eq(designComponents.userId, opts.userId)];

  if (opts.category) {
    conditions.push(eq(designComponents.category, opts.category));
  }
  if (opts.framework) {
    conditions.push(eq(designComponents.framework, opts.framework));
  }
  if (opts.favoritesOnly) {
    conditions.push(eq(designComponents.isFavorite, true));
  }
  if (opts.projectId) {
    conditions.push(eq(designComponents.projectId, opts.projectId));
  }
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(
      sql`(${designComponents.name} LIKE ${pattern} ESCAPE '\\' OR ${designComponents.description} LIKE ${pattern} ESCAPE '\\')`
    );
  }

  const rows = await db
    .select()
    .from(designComponents)
    .where(and(...conditions))
    .orderBy(desc(designComponents.updatedAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);

  return rows.map(toRow);
}

/** Update a component (partial), scoped to a user. */
export async function updateDesignComponent(
  userId: string,
  id: string,
  updates: Partial<NewDesignComponent>
): Promise<DesignComponentRow | null> {
  const values: Record<string, unknown> = { updatedAt: now() };

  if (updates.name !== undefined) values.name = updates.name;
  if (updates.description !== undefined) values.description = updates.description;
  if (updates.prompt !== undefined) values.prompt = updates.prompt;
  if (updates.code !== undefined) values.code = updates.code;
  if (updates.framework !== undefined) values.framework = updates.framework;
  if (updates.category !== undefined) values.category = updates.category;
  if (updates.tags !== undefined) values.tags = JSON.stringify(updates.tags);
  if (updates.styleTags !== undefined) values.styleTags = JSON.stringify(updates.styleTags);
  if (updates.previewPath !== undefined) values.previewPath = updates.previewPath;
  if (updates.mode !== undefined) values.mode = updates.mode;
  if (updates.style !== undefined) values.style = updates.style;
  if (updates.characterId !== undefined) values.characterId = updates.characterId;
  if (updates.sessionId !== undefined) values.sessionId = updates.sessionId;
  if (updates.projectId !== undefined) values.projectId = updates.projectId;

  const [updated] = await db
    .update(designComponents)
    .set(values)
    .where(and(eq(designComponents.userId, userId), eq(designComponents.id, id)))
    .returning();

  return updated ? toRow(updated) : null;
}

/** Delete a component scoped to a user. Returns true if a row was deleted. */
export async function deleteDesignComponent(userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(designComponents)
    .where(and(eq(designComponents.userId, userId), eq(designComponents.id, id)))
    .returning({ id: designComponents.id });

  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Toggle the favorite flag atomically, returning the new state or null if not found. */
export async function toggleDesignFavorite(userId: string, id: string): Promise<boolean | null> {
  const [updated] = await db
    .update(designComponents)
    .set({
      isFavorite: sql`NOT ${designComponents.isFavorite}`,
      updatedAt: now(),
    })
    .where(and(eq(designComponents.userId, userId), eq(designComponents.id, id)))
    .returning({ isFavorite: designComponents.isFavorite });

  return updated ? Boolean(updated.isFavorite) : null;
}

/** Increment the use count and update lastUsedAt, scoped to a user. */
export async function incrementDesignUseCount(userId: string, id: string): Promise<void> {
  await db
    .update(designComponents)
    .set({
      useCount: sql`${designComponents.useCount} + 1`,
      lastUsedAt: now(),
      updatedAt: now(),
    })
    .where(and(eq(designComponents.userId, userId), eq(designComponents.id, id)));
}

