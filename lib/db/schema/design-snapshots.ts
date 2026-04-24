import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { designComponents } from "./design-gallery";

// ============================================================================
// DESIGN SNAPSHOTS TABLE
//
// Persisted iteration memory. Rows here are snapshots the user / agent
// EXPLICITLY kept — named, pinned, or saved for diffing / later recall.
//
// Keep this schema SEPARATE from the in-memory `DesignSnapshot` in
// `lib/design/workspace/types.ts` — that one is Zustand-scoped transient
// undo history. See `lib/design/workspace/persisted-snapshot-types.ts` for
// the app-facing row type.
//
// Indexes:
//   - idx_design_snapshots_user_session_created: list-ordering (descending).
//   - idx_design_snapshots_component: cascade-delete + component-scoped lookups.
//   - idx_design_snapshots_user_session_pinned: pinned-filter.
// ============================================================================

export const designSnapshots = sqliteTable(
  "design_snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    componentId: text("component_id")
      .notNull()
      .references(() => designComponents.id, { onDelete: "cascade" }),

    sourceCode: text("source_code").notNull(),
    name: text("name"),
    isPinned: integer("is_pinned", { mode: "boolean" }).default(false).notNull(),
    metadata: text("metadata"),

    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    idxDesignSnapshotsUserSessionCreated: index(
      "idx_design_snapshots_user_session_created",
    ).on(table.userId, table.sessionId, table.createdAt),
    idxDesignSnapshotsComponent: index("idx_design_snapshots_component").on(
      table.componentId,
    ),
    idxDesignSnapshotsUserSessionPinned: index(
      "idx_design_snapshots_user_session_pinned",
    ).on(table.userId, table.sessionId, table.isPinned),
  }),
);

export type DesignSnapshotRecord = typeof designSnapshots.$inferSelect;
export type NewDesignSnapshotRecord = typeof designSnapshots.$inferInsert;
