/**
 * Sprint 4 W4.3 — persisted "last active component" pointer.
 *
 * Reads/writes the `sessions.last_active_component_id` column so the design
 * workspace can rehydrate the user's last-focused component across session
 * restart. See migration `lib/db/migrations/session-last-active-component.ts`
 * for schema + FK semantics.
 *
 * Scope discipline:
 *   - `setLastActiveComponentId` ALWAYS requires `userId` + `sessionId` and
 *     verifies that the (userId, sessionId) pair owns the session row AND the
 *     target component (via `findDesignComponentForScope`). Cross-session or
 *     cross-user writes are rejected with a structured error — never leak
 *     existence, never write on a mismatch.
 *   - Clearing the pointer (null) still requires matching (userId, sessionId)
 *     so an attacker can't wipe someone else's pointer.
 *   - `getLastActiveComponentId` returns `null` for unknown pointer, for a
 *     pointer that no longer resolves to a live component, OR for a pointer
 *     that points at a component the (userId, sessionId) scope doesn't own.
 *     Stale / orphaned pointers MUST read as `null` — the graceful-pointer
 *     contract from W4.3.
 *
 * All operations are source-level; this module is imported directly by the
 * API route and tests. No barrel export.
 */

import { db } from "@/lib/db/sqlite-client";
import { sessions } from "@/lib/db/sqlite-schema";
import { designComponents } from "@/lib/db/schema/design-gallery";
import { and, eq } from "drizzle-orm";

/** Result envelope for `setLastActiveComponentId`. */
export type SetLastActiveComponentResult =
  | { ok: true; lastActiveComponentId: string | null }
  | {
      ok: false;
      /** Agent-actionable reason code. Never a bare message. */
      reason:
        | "SESSION_NOT_FOUND"
        | "SESSION_SCOPE_MISMATCH"
        | "COMPONENT_NOT_FOUND"
        | "COMPONENT_SCOPE_MISMATCH";
      message: string;
    };

/**
 * Persist the "currently focused" component pointer on a session.
 *
 * `componentId === null` clears the pointer (used when the user closes the
 * workspace or removes the last component).
 *
 * Scope checks:
 *   1. The session row must exist AND have `user_id === userId`.
 *   2. When `componentId !== null`, the component must resolve under the
 *      same (userId, sessionId) scope via `findDesignComponentForScope`.
 *
 * Atomicity (Sprint 4 W4.3 — Rev-J2 / M3 fix):
 *   - The session check, component check, and `sessions` UPDATE run inside
 *     a single `db.transaction()` so the window between the existence read
 *     and the write is closed. If the component is deleted between the
 *     two statements the transaction's SQL view still sees it and the
 *     UPDATE succeeds — no SQLITE_CONSTRAINT escape.
 *   - As a belt-and-braces safeguard we still catch FK constraint errors
 *     from the UPDATE and translate them into the structured
 *     COMPONENT_NOT_FOUND outcome (same shape as "component not found")
 *     so an unexpected race never escapes as an HTTP 500.
 */
export async function setLastActiveComponentId(params: {
  userId: string;
  sessionId: string;
  componentId: string | null;
}): Promise<SetLastActiveComponentResult> {
  const { userId, sessionId, componentId } = params;

  try {
    return db.transaction((tx): SetLastActiveComponentResult => {
      // 1. Session scope check — load the session row and verify ownership
      //    before touching any other table. Cross-user writes must never
      //    succeed, even transiently.
      const [sessionRow] = tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)
        .all();

      if (!sessionRow) {
        return {
          ok: false,
          reason: "SESSION_NOT_FOUND",
          message: `Session ${sessionId} not found.`,
        };
      }

      if (sessionRow.userId !== userId) {
        // Do not leak existence. Use a distinct reason so the API layer can
        // map it to a generic 404 if desired.
        return {
          ok: false,
          reason: "SESSION_SCOPE_MISMATCH",
          message: `Session ${sessionId} does not belong to the requesting user.`,
        };
      }

      // 2. Component scope check — only when setting a non-null pointer.
      //    Clearing (null) skips this branch.
      //
      //    IMPORTANT: `findDesignComponentForScope` short-circuits when both
      //    userId and sessionId are supplied — it applies only the userId
      //    filter, so a row owned by the same user but a DIFFERENT session
      //    would pass. We need stricter (userId AND sessionId) matching here,
      //    so we run the check directly against the `design_components` row
      //    and classify the outcome ourselves.
      if (componentId !== null) {
        const [row] = tx
          .select()
          .from(designComponents)
          .where(eq(designComponents.id, componentId))
          .limit(1)
          .all();

        if (!row) {
          return {
            ok: false,
            reason: "COMPONENT_NOT_FOUND",
            message: `Component ${componentId} not found.`,
          };
        }

        if (row.userId !== userId) {
          // Don't leak existence — classify as NOT_FOUND so a cross-user
          // probe is indistinguishable from a typo.
          return {
            ok: false,
            reason: "COMPONENT_NOT_FOUND",
            message: `Component ${componentId} not found.`,
          };
        }

        if (row.sessionId !== sessionId) {
          // Same user, different session — structured "scope mismatch" so
          // the agent can rebind to the right session if it actually owns
          // the component.
          return {
            ok: false,
            reason: "COMPONENT_SCOPE_MISMATCH",
            message: `Component ${componentId} is not owned by session ${sessionId}.`,
          };
        }
      }

      // 3. Persist. Scope condition doubled up in the WHERE clause so even a
      //    race between the ownership check and this UPDATE cannot touch a row
      //    the user doesn't own. Running inside the same transaction as the
      //    existence checks above closes the check → update window.
      tx
        .update(sessions)
        .set({
          lastActiveComponentId: componentId,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .run();

      return { ok: true, lastActiveComponentId: componentId };
    });
  } catch (error) {
    // Defense in depth: if FK enforcement somehow fires (e.g. the component
    // is deleted between the in-transaction check and the UPDATE on a
    // database configured without statement-level snapshot isolation),
    // translate the failure into the structured COMPONENT_NOT_FOUND
    // outcome instead of letting it escape as an HTTP 500. The UI can
    // treat this identically to the ordinary not-found branch (clear
    // active component, show picker state).
    const code = (error as { code?: unknown })?.code;
    if (
      typeof code === "string" &&
      (code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
        code === "SQLITE_CONSTRAINT_TRIGGER" ||
        code === "SQLITE_CONSTRAINT")
    ) {
      return {
        ok: false,
        reason: "COMPONENT_NOT_FOUND",
        message:
          componentId !== null
            ? `Component ${componentId} not found.`
            : `Component not found.`,
      };
    }
    throw error;
  }
}

/**
 * Read the persisted pointer. Returns `null` when:
 *   - The session doesn't exist or isn't owned by `userId`.
 *   - The pointer was never set.
 *   - The pointer references a component that no longer resolves under
 *     (userId, sessionId). This is the "stale pointer" case — we never
 *     surface a componentId the caller can't actually use.
 *
 * When a stale pointer is detected, the function ALSO clears it (best-effort,
 * scoped UPDATE) so subsequent reads don't repeat the scope check.
 */
export async function getLastActiveComponentId(params: {
  userId: string;
  sessionId: string;
}): Promise<string | null> {
  const { userId, sessionId } = params;

  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!sessionRow) return null;
  if (sessionRow.userId !== userId) return null;

  const pointer = sessionRow.lastActiveComponentId;
  if (!pointer) return null;

  // Validate the pointer still resolves under the caller's scope. If the
  // component was deleted the FK clause `ON DELETE SET NULL` already nulled
  // the pointer, so this branch catches the rarer case of an out-of-scope
  // pointer (e.g. session was reassigned, component moved) and the even
  // rarer case of FK being disabled in a test context. We match on
  // (userId, sessionId) both — a row that belongs to the same user but a
  // different session is treated as stale here too.
  const row = await db.query.designComponents.findFirst({
    where: eq(designComponents.id, pointer),
  });

  const stillOwned =
    row !== undefined && row.userId === userId && row.sessionId === sessionId;

  if (!stillOwned) {
    // Best-effort cleanup — scope-check doubled up in the WHERE clause.
    await db
      .update(sessions)
      .set({
        lastActiveComponentId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    return null;
  }

  return pointer;
}
