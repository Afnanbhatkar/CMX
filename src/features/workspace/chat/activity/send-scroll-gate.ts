"use client";

/**
 * CodeMind X V2 — scroll-on-send arrival gate (user mandate, RULES.md §15).
 *
 * "Scroll on Message Send": when the user sends a message — from ANY scroll
 * position, even from far up the conversation — the view smoothly scrolls
 * the newly sent user message to its pinned TOP position, and the run (and
 * with it the thought chain) starts ONLY once the scroll has ARRIVED. This
 * tiny module is the handshake between the composer's send() (arms the gate,
 * waits for arrival) and ConversationView's anchor effect (performs the
 * controlled scroll, releases the gate on arrival).
 *
 * Safety: the wait is always bounded by SEND_SCROLL_GATE_TIMEOUT_MS so a
 * send can never stall because the view is not mounted or the anchor effect
 * did not run — the run then starts anyway, exactly like before.
 */

/** Upper bound for "the view will arrive" — never stall a real run. */
export const SEND_SCROLL_GATE_TIMEOUT_MS = 1500;

let armed = false;
let releaseWaiters: Array<() => void> = [];

/** send(): call synchronously BEFORE the user message enters the store. */
export function armSendScrollGate(): void {
  armed = true;
}

/**
 * ConversationView: call when the view has arrived at the pinned question
 * (or when the user interrupted the scroll by taking over — their scroll
 * wins and the run must not be held hostage). No-op when nothing is armed.
 */
export function releaseSendScrollGate(): void {
  if (!armed) return;
  armed = false;
  const waiters = releaseWaiters;
  releaseWaiters = [];
  for (const waiter of waiters) waiter();
}

/** True while the view still owes an arrival. */
export function isSendScrollGateArmed(): boolean {
  return armed;
}

/**
 * send(): resolves when the view arrived at the new question — or after the
 * safety timeout, whichever comes first. Never rejects.
 */
export function waitForSendScrollArrival(
  timeoutMs: number = SEND_SCROLL_GATE_TIMEOUT_MS,
): Promise<void> {
  if (!armed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      releaseWaiters = releaseWaiters.filter((w) => w !== finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    releaseWaiters.push(finish);
  });
}
