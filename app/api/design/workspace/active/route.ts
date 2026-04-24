/**
 * Sprint 4 W4.3 — `last_active_component_id` HTTP surface.
 *
 *   GET  /api/design/workspace/active?sessionId=<id>
 *     → `{ success: true, data: { lastActiveComponentId: string | null } }`
 *
 *   POST /api/design/workspace/active
 *     body: { sessionId: string, componentId: string | null }
 *     → on success: `{ success: true, data: { lastActiveComponentId: string | null } }`
 *     → on scope/not-found failure: `{ success: false, error, reason }` with
 *       4xx status. The `reason` field is agent-actionable
 *       (SESSION_NOT_FOUND, SESSION_SCOPE_MISMATCH, COMPONENT_NOT_FOUND,
 *       COMPONENT_SCOPE_MISMATCH) — never strip the rejection into a
 *       generic 500 without a replacement.
 *
 * Authentication + scoping: every request resolves `userId` via
 * `requireAuth`. The query helpers run a double scope check
 * (userId vs session.user_id; componentId vs (userId, sessionId) scope)
 * so a mismatched request never writes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/local-auth";
import {
  getLastActiveComponentId,
  setLastActiveComponentId,
} from "@/lib/design/workspace/last-active-component-queries";

const MAX_ID_LENGTH = 255;

function isNonEmptyString(val: unknown, maxLen: number): val is string {
  return typeof val === "string" && val.length > 0 && val.length <= maxLen;
}

function mapReasonToStatus(reason: string): number {
  switch (reason) {
    case "SESSION_NOT_FOUND":
    case "COMPONENT_NOT_FOUND":
      return 404;
    case "SESSION_SCOPE_MISMATCH":
    case "COMPONENT_SCOPE_MISMATCH":
      // Do not leak existence — return 404 so probing for someone else's
      // session / component is indistinguishable from a not-found.
      return 404;
    default:
      return 400;
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuth(request);
    // Using the standard URL constructor instead of `request.nextUrl`
    // keeps the route testable under a plain `Request` (unit tests don't
    // go through the Next.js request decorator).
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (!isNonEmptyString(sessionId, MAX_ID_LENGTH)) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid sessionId" },
        { status: 400 },
      );
    }

    const lastActiveComponentId = await getLastActiveComponentId({
      userId,
      sessionId,
    });
    return NextResponse.json({
      success: true,
      data: { lastActiveComponentId },
    });
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg === "Unauthorized" || msg === "Invalid session") {
        return NextResponse.json({ success: false, error: msg }, { status: 401 });
      }
    }
    console.error("[design/workspace/active] GET failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read active component pointer." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireAuth(request);
    const body = (await request.json()) as {
      sessionId?: unknown;
      componentId?: unknown;
    };

    if (!isNonEmptyString(body.sessionId, MAX_ID_LENGTH)) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid sessionId" },
        { status: 400 },
      );
    }
    const sessionId = body.sessionId;

    // `componentId` is required by presence (the client must send it) but
    // can be `null` to clear the pointer. Anything else is invalid.
    let componentId: string | null;
    if (body.componentId === null) {
      componentId = null;
    } else if (isNonEmptyString(body.componentId, MAX_ID_LENGTH)) {
      componentId = body.componentId;
    } else {
      return NextResponse.json(
        { success: false, error: "componentId must be a string or null" },
        { status: 400 },
      );
    }

    const result = await setLastActiveComponentId({
      userId,
      sessionId,
      componentId,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
          reason: result.reason,
        },
        { status: mapReasonToStatus(result.reason) },
      );
    }

    return NextResponse.json({
      success: true,
      data: { lastActiveComponentId: result.lastActiveComponentId },
    });
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg === "Unauthorized" || msg === "Invalid session") {
        return NextResponse.json({ success: false, error: msg }, { status: 401 });
      }
    }
    console.error("[design/workspace/active] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to persist active component pointer." },
      { status: 500 },
    );
  }
}
