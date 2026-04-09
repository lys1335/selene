import { db } from "@/lib/db/sqlite-client";
import { designProjects, designComponents } from "@/lib/db/schema/design-gallery";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import type {
  NewDesignProject,
  DesignProjectRow,
  DesignProjectWithComponents,
  DesignComponentRow,
  ProjectSearchOpts,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function toProjectRow(row: typeof designProjects.$inferSelect): DesignProjectRow {
  return {
    ...row,
    tags: safeParseTags(row.tags),
    isArchived: Boolean(row.isArchived),
  };
}

function toComponentRow(row: typeof designComponents.$inferSelect): DesignComponentRow {
  return {
    ...row,
    tags: safeParseTags(row.tags),
    styleTags: safeParseTags(row.styleTags),
    isFavorite: Boolean(row.isFavorite),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Create a new design project. */
export async function createProject(
  userId: string,
  data: NewDesignProject
): Promise<DesignProjectRow> {
  const id = crypto.randomUUID();
  const ts = now();

  const [inserted] = await db
    .insert(designProjects)
    .values({
      id,
      userId,
      name: data.name,
      description: data.description ?? null,
      tags: JSON.stringify(data.tags ?? []),
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();

  return toProjectRow(inserted);
}

/** Update a project's metadata, scoped to the owning user. */
export async function updateProject(
  userId: string,
  projectId: string,
  updates: Partial<NewDesignProject>
): Promise<DesignProjectRow | null> {
  const values: Record<string, unknown> = { updatedAt: now() };

  if (updates.name !== undefined) values.name = updates.name;
  if (updates.description !== undefined) values.description = updates.description;
  if (updates.tags !== undefined) values.tags = JSON.stringify(updates.tags);

  const [updated] = await db
    .update(designProjects)
    .set(values)
    .where(and(eq(designProjects.userId, userId), eq(designProjects.id, projectId)))
    .returning();

  return updated ? toProjectRow(updated) : null;
}

/** Delete a project. Unlinks its components (sets their projectId to null) but does not delete them. */
export async function deleteProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  // Unlink all components belonging to this project
  await db
    .update(designComponents)
    .set({ projectId: null, updatedAt: now() })
    .where(
      and(
        eq(designComponents.userId, userId),
        eq(designComponents.projectId, projectId)
      )
    );

  const result = await db
    .delete(designProjects)
    .where(and(eq(designProjects.userId, userId), eq(designProjects.id, projectId)))
    .returning({ id: designProjects.id });

  return result.length > 0;
}

/** List projects for a user with optional search and archive filter. */
export async function listProjects(
  opts: ProjectSearchOpts
): Promise<DesignProjectRow[]> {
  const conditions: SQL[] = [eq(designProjects.userId, opts.userId)];

  if (!opts.includeArchived) {
    conditions.push(eq(designProjects.isArchived, false));
  }

  if (opts.search) {
    const pattern = `%${escapeLike(opts.search)}%`;
    conditions.push(
      sql`(${designProjects.name} LIKE ${pattern} ESCAPE '\\' OR ${designProjects.description} LIKE ${pattern} ESCAPE '\\')`
    );
  }

  const rows = await db
    .select()
    .from(designProjects)
    .where(and(...conditions))
    .orderBy(desc(designProjects.updatedAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);

  return rows.map(toProjectRow);
}

/** Get a single project with its components, scoped to the owning user. */
export async function getProject(
  userId: string,
  projectId: string
): Promise<DesignProjectWithComponents | null> {
  const project = await db.query.designProjects.findFirst({
    where: and(eq(designProjects.userId, userId), eq(designProjects.id, projectId)),
  });

  if (!project) return null;

  const components = await db
    .select()
    .from(designComponents)
    .where(
      and(
        eq(designComponents.userId, userId),
        eq(designComponents.projectId, projectId)
      )
    )
    .orderBy(desc(designComponents.updatedAt));

  return {
    ...toProjectRow(project),
    components: components.map(toComponentRow),
  };
}

/** Link a component to a project. Updates componentCount and coverImageUrl. */
export async function addComponentToProject(
  userId: string,
  componentId: string,
  projectId: string
): Promise<boolean> {
  // Verify the project belongs to the user
  const project = await db.query.designProjects.findFirst({
    where: and(eq(designProjects.userId, userId), eq(designProjects.id, projectId)),
  });
  if (!project) return false;

  // Update the component's projectId
  const [updated] = await db
    .update(designComponents)
    .set({ projectId, updatedAt: now() })
    .where(
      and(eq(designComponents.userId, userId), eq(designComponents.id, componentId))
    )
    .returning();

  if (!updated) return false;

  // Recount components and update cover image
  await syncProjectCounts(userId, projectId);

  return true;
}

/** Unlink a component from its project (set projectId to null). */
export async function removeComponentFromProject(
  userId: string,
  componentId: string
): Promise<boolean> {
  // Find the component to get its current projectId
  const component = await db.query.designComponents.findFirst({
    where: and(
      eq(designComponents.userId, userId),
      eq(designComponents.id, componentId)
    ),
  });

  if (!component || !component.projectId) return false;

  const previousProjectId = component.projectId;

  const [updated] = await db
    .update(designComponents)
    .set({ projectId: null, updatedAt: now() })
    .where(
      and(eq(designComponents.userId, userId), eq(designComponents.id, componentId))
    )
    .returning();

  if (!updated) return false;

  // Recount components and update cover image for the previous project
  await syncProjectCounts(userId, previousProjectId);

  return true;
}

/** Soft-delete (archive) a project. */
export async function archiveProject(
  userId: string,
  projectId: string
): Promise<DesignProjectRow | null> {
  const [updated] = await db
    .update(designProjects)
    .set({ isArchived: true, updatedAt: now() })
    .where(and(eq(designProjects.userId, userId), eq(designProjects.id, projectId)))
    .returning();

  return updated ? toProjectRow(updated) : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Recompute componentCount and coverImageUrl for a project. */
async function syncProjectCounts(userId: string, projectId: string): Promise<void> {
  const components = await db
    .select({
      id: designComponents.id,
      previewPath: designComponents.previewPath,
    })
    .from(designComponents)
    .where(
      and(
        eq(designComponents.userId, userId),
        eq(designComponents.projectId, projectId)
      )
    )
    .orderBy(designComponents.createdAt);

  const count = components.length;
  const firstPreview = components.find((c) => c.previewPath)?.previewPath ?? null;
  const coverImageUrl = firstPreview
    ? `/api/media/${firstPreview.replace(/^\/+/, "")}`
    : null;

  await db
    .update(designProjects)
    .set({ componentCount: count, coverImageUrl, updatedAt: now() })
    .where(and(eq(designProjects.userId, userId), eq(designProjects.id, projectId)));
}
