"use client";

/**
 * CodeMind X V2 — chain-close gate (user mandate, RULES.md §15
 * "Thought Chain Working Phase").
 *
 * Mandated sequence: the thought chain tells its story one-by-one → the last
 * row holds a 1.5s loader → the loader ENDS → the chain closes FULLY in one
 * shot → and ONLY THEN the AI response starts. This tiny module is the
 * handshake between ActivityChain's close machine (releases the gate at the
 * exact fullClose moment) and use-assistant-run's startAnswerReveal (holds
 * the honestly-buffered answer until that moment).
 *
 * Safety: the wait is always bounded by CHAIN_CLOSE_GATE_TIMEOUT_MS so an
 * unmounted or hidden view can never stall a real answer — the reveal then
 * starts anyway, exactly like before the gate existed.
 */

/** Upper bound for "the live close will land" — never stall a real answer. */
export const CHAIN_CLOSE_GATE_TIMEOUT_MS = 2500;

let armed = false;
let releaseWaiters: Array<() => void> = [];

/** use-assistant-run: arm right before the buffered answer starts waiting. */
export function armChainCloseGate(): void {
  gateLog("arm");
  armed = true;
}

/**
 * ActivityChain close machine: call at the FULL one-shot close moment (the
 * same tick the loader ends and the chain collapses). No-op when nothing is
 * armed. Idempotent.
 */
export function releaseChainCloseGate(): void {
  gateLog(armed ? "release" : "release-noop");
  if (!armed) return;
  armed = false;
  const waiters = releaseWaiters;
  releaseWaiters = [];
  for (const waiter of waiters) waiter();
}

/**
 * Terminal hygiene (error / stop / empty paths): the run is over, the gate
 * must not stay armed into the next run. Pending waiters are resolved —
 * their continuation is guarded on the caller side and reveals nothing on
 * a terminal path.
 */
export function resetChainCloseGate(): void {
  armed = false;
  const waiters = releaseWaiters;
  releaseWaiters = [];
  for (const waiter of waiters) waiter();
}

/** True while an answer still owes a full chain close. */
export function isChainCloseGateArmed(): boolean {
  return armed;
}

/**
 * Read-only verification probe (same pattern as window.__cmxAssistant):
 * lets the E2E harness assert the mandated sequence from the SOURCE of
 * truth — gate arms, the close machine's loader/fullClose moments, and the
 * answer-begin moment — instead of sampling the DOM.
 */
declare global {
  interface Window {
    __cmxChainGate?: {
      log: (event: string, detail?: number) => void;
      events: { t: number; e: string; d?: number }[];
    };
  }
}
function gateLog(event: string, detail?: number): void {
  if (typeof window === "undefined") return;
  const probe = (window.__cmxChainGate ??= { log: gateLog, events: [] });
  probe.events.push({ t: Math.round(performance.now()), e: event, d: detail });
  if (probe.events.length > 200) probe.events.shift();
}

/** Read-only probe shared with the close machine + run hook (E2E). */
export function logChainGate(event: string, detail?: number): void {
  gateLog(event, detail);
}

/**
 * use-assistant-run: resolves when the chain has FULLY closed (loader ended
 * + one-shot close) — or after the safety timeout, whichever comes first.
 * Never rejects.
 */
export function waitForChainFullyClosed(
  timeoutMs: number = CHAIN_CLOSE_GATE_TIMEOUT_MS,
): Promise<void> {
  if (!armed) {
    gateLog("wait-instant");
    return Promise.resolve();
  }
  gateLog("wait");
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (how: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      gateLog(how);
      releaseWaiters = releaseWaiters.filter((w) => w !== finish);
      resolve();
    };
    const timer = setTimeout(() => finish("wait-timeout"), timeoutMs);
    releaseWaiters.push(() => finish("wait-released"));
  });
}
