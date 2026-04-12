import { requireAuth } from "@/lib/auth/local-auth";
import { onDelegationCompleted } from "@/lib/background-tasks/delegation-completion-signal";
import { hasPendingDelegationCompletions } from "@/lib/ai/tools/delegation-completion-store";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET — SSE endpoint that streams delegation completion events for a session.
 *
 * The frontend connects here after a response that launched delegations.
 * When a subagent completes and its result lands in the completion store,
 * this endpoint emits a `delegation-completed` event so the frontend can
 * auto-resume the conversation (send a continuation message to /api/chat).
 *
 * The stream auto-closes after 5 minutes or when the client disconnects.
 */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    await requireAuth(req);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: sessionId } = await params;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // Controller closed
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Immediately check for pending completions
      if (hasPendingDelegationCompletions(sessionId)) {
        send("delegation-completed", JSON.stringify({ immediate: true }));
      }

      // Subscribe to future completion signals
      unsubscribe = onDelegationCompleted(sessionId, () => {
        send("delegation-completed", JSON.stringify({ immediate: false }));
      });

      // Heartbeat every 15 seconds to keep connection alive
      heartbeatTimer = setInterval(() => {
        if (closed) {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      // Auto-close after 5 minutes to prevent leaked connections
      timeoutTimer = setTimeout(() => {
        send("timeout", JSON.stringify({ reason: "max-duration" }));
        cleanup();
      }, 5 * 60 * 1000);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
