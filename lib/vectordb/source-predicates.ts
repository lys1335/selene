/**
 * Source-discriminator predicates for `agent_sync_folders`.
 *
 * `agent_sync_folders.source` distinguishes two very different classes of rows:
 *   - `source='user'`       — user-configured vector-sync knowledge base folder
 *   - `source='workspace'`  — ephemeral path-authorization registration for a
 *                             workspace-tool git worktree (no vectors, no UI)
 *
 * Almost every query over this table *should* filter workspace-sourced rows
 * out — they pollute counts, leak into shared-folder snapshots, and surface
 * ephemeral worktree paths in places they don't belong.
 *
 * Previously callers hand-wrote `ne(agentSyncFolders.source, "workspace")`
 * inline. That pattern is fragile: the next developer adding a new query
 * forgets the filter and a silent regression ships. This module centralizes
 * the predicate so every query can compose a single named helper, and so if
 * the discriminator ever grows (e.g. `shared`, `auto-indexed`), there is one
 * place to update.
 *
 * Usage:
 *   import { excludeWorkspaceSource } from "@/lib/vectordb/source-predicates";
 *   ...
 *   .where(and(eq(agentSyncFolders.characterId, cid), excludeWorkspaceSource()))
 */

import { eq, ne, type SQL } from "drizzle-orm";
import { agentSyncFolders } from "@/lib/db/sqlite-character-schema";

/**
 * Exclude workspace-tool path-authorization rows. Compose with `and()` for
 * queries that should see user/workflow-managed folders only.
 *
 * Use this by default in any query that feeds UI counts, shared-folder
 * snapshots, workflow propagation, or cross-member visibility.
 */
export function excludeWorkspaceSource(): SQL {
  return ne(agentSyncFolders.source, "workspace");
}

/**
 * Opposite of `excludeWorkspaceSource`: match only user-sourced rows.
 * Equivalent semantics today (source enum has two values), but this keeps
 * callers honest if the enum grows.
 */
export function onlyUserSource(): SQL {
  return eq(agentSyncFolders.source, "user");
}

/**
 * Match only workspace-tool rows. Used by the boot-time orphan sweep, the
 * metrics snapshot, and any future workspace-specific admin surface.
 */
export function onlyWorkspaceSource(): SQL {
  return eq(agentSyncFolders.source, "workspace");
}
