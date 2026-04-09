import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users, sessions } from "../sqlite-schema-base";
import { characters } from "../sqlite-character-schema";

// ============================================================================
// DESIGN PROJECTS TABLE
// ============================================================================

export const designProjects = sqliteTable(
  "design_projects",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    name: text("name").notNull(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),

    // Tags stored as JSON array in text column
    tags: text("tags").notNull().default("[]"),

    isArchived: integer("is_archived", { mode: "boolean" }).default(false).notNull(),
    componentCount: integer("component_count").notNull().default(0),

    // Timestamps
    createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
    updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
  },
  (table) => ({
    idxDesignProjectsUser: index("idx_design_projects_user").on(table.userId),
    idxDesignProjectsUpdated: index("idx_design_projects_updated").on(table.userId, table.updatedAt),
  })
);

// ============================================================================
// DESIGN COMPONENTS TABLE (Component Gallery)
// ============================================================================

export const designComponents = sqliteTable(
  "design_components",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    characterId: text("character_id").references(() => characters.id, { onDelete: "set null" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => designProjects.id, { onDelete: "set null" }),

    // Component content
    name: text("name").notNull(),
    description: text("description"),
    prompt: text("prompt").notNull(),
    code: text("code").notNull(),
    framework: text("framework").notNull().default("html-css"),
    category: text("category").notNull().default("general"),

    // Tags stored as JSON arrays in text columns
    tags: text("tags").notNull().default("[]"),
    styleTags: text("style_tags").notNull().default("[]"),

    // Preview / rendering
    previewPath: text("preview_path"),
    mode: text("mode").notNull().default("tailwind"),
    style: text("style").notNull().default("default"),

    // Usage tracking
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    isFavorite: integer("is_favorite", { mode: "boolean" }).default(false).notNull(),

    // Timestamps
    createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
    updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
  },
  (table) => ({
    idxDesignComponentsUser: index("idx_design_components_user").on(table.userId),
    idxDesignComponentsCategory: index("idx_design_components_category").on(table.userId, table.category),
    idxDesignComponentsUpdated: index("idx_design_components_updated").on(table.userId, table.updatedAt),
    idxDesignComponentsProject: index("idx_design_components_project").on(table.projectId),
  })
);

// ============================================================================
// TYPES
// ============================================================================

export type DesignComponentRecord = typeof designComponents.$inferSelect;
export type NewDesignComponentRecord = typeof designComponents.$inferInsert;

export type DesignProjectRecord = typeof designProjects.$inferSelect;
export type NewDesignProjectRecord = typeof designProjects.$inferInsert;
