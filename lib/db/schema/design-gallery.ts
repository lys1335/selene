import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users, sessions } from "../sqlite-schema";
import { characters } from "../sqlite-character-schema";

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
    mode: text("mode").notNull().default("html"),
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
  })
);

// ============================================================================
// TYPES
// ============================================================================

export type DesignComponentRecord = typeof designComponents.$inferSelect;
export type NewDesignComponentRecord = typeof designComponents.$inferInsert;
