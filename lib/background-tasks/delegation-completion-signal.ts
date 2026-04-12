/**
 * Delegation Completion Signal
 *
 * EventEmitter-based notification for when a subagent delegation completes
 * and the initiator's run is no longer active (no live prompt queue).
 *
 * The SSE endpoint at /api/sessions/[id]/delegation-events subscribes to
 * these signals so the frontend can auto-resume the conversation.
 */

import { EventEmitter } from "events";

const globalForSignal = globalThis as typeof globalThis & {
  delegationCompletionEvents?: EventEmitter;
};

function getEmitter(): EventEmitter {
  if (!globalForSignal.delegationCompletionEvents) {
    globalForSignal.delegationCompletionEvents = new EventEmitter();
    globalForSignal.delegationCompletionEvents.setMaxListeners(50);
  }
  return globalForSignal.delegationCompletionEvents;
}

/**
 * Emit a signal that a delegation completed for a given initiator session.
 * Called from notifyInitiatorSessionOfCompletion when the live prompt queue
 * is not active (run ended) and the result was stored in the completion store.
 */
export function emitDelegationCompleted(sessionId: string): void {
  getEmitter().emit(`delegation:${sessionId}`);
}

/**
 * Subscribe to delegation completion signals for a session.
 * Returns an unsubscribe function.
 */
export function onDelegationCompleted(
  sessionId: string,
  callback: () => void,
): () => void {
  const event = `delegation:${sessionId}`;
  getEmitter().on(event, callback);
  return () => {
    getEmitter().off(event, callback);
  };
}
