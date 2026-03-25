/**
 * Tracks sessions that had undrained live-prompt queue messages when a run ended.
 *
 * When a run ends before prepareStep could drain the queue, the messages were
 * never processed by the model. Instead of persisting them to DB (which creates
 * dangling messages with no response), we set this flag so the frontend can
 * convert the injected-live chips to "fallback" and replay them as a new run.
 *
 * Lifecycle: set in onFinish/onAbort when drainLivePromptQueue returns entries,
 * consumed (and cleared) by the /consume-undrained-signal endpoint after the
 * frontend receives the run-end event.
 *
 * For channel sessions (Telegram, WhatsApp, etc.), there is no frontend to poll
 * the signal. Instead, listeners on `undrainedEvents` can re-trigger processing
 * when the signal fires.
 */

import { EventEmitter } from "events";

const globalForUndrainedSignal = globalThis as typeof globalThis & {
  undrainedSessions?: Set<string>;
  undrainedEvents?: EventEmitter;
};

function getSet(): Set<string> {
  if (!globalForUndrainedSignal.undrainedSessions) {
    globalForUndrainedSignal.undrainedSessions = new Set();
  }
  return globalForUndrainedSignal.undrainedSessions;
}

/** Event emitter for undrained message signals. Listeners receive sessionId. */
export function getUndrainedEvents(): EventEmitter {
  if (!globalForUndrainedSignal.undrainedEvents) {
    globalForUndrainedSignal.undrainedEvents = new EventEmitter();
    globalForUndrainedSignal.undrainedEvents.setMaxListeners(20);
  }
  return globalForUndrainedSignal.undrainedEvents;
}

/** Mark a session as having undrained messages that need a new run. */
export function signalUndrainedMessages(sessionId: string): void {
  getSet().add(sessionId);
  getUndrainedEvents().emit("undrained", sessionId);
}

/**
 * Check-and-clear: returns true if the session had undrained messages,
 * then removes the flag so subsequent calls return false.
 */
export function consumeUndrainedSignal(sessionId: string): boolean {
  const set = getSet();
  if (set.has(sessionId)) {
    set.delete(sessionId);
    return true;
  }
  return false;
}
