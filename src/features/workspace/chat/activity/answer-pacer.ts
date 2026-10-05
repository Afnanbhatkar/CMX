"use client";

/**
 * CodeMind X V2 — word-by-word answer reveal pacer (Phase 9).
 *
 * The gateway now streams REAL token deltas (`stream: true`), but the
 * transport delivers them in network bursts — one TCP read can carry a
 * dozen tokens, then silence, then another burst. Every serious chat UI
 * (ChatGPT, Claude) smooths this with a reveal pacer; this is ours.
 *
 * Contract (honesty, RULES.md §9):
 * - it NEVER invents text: only content that actually arrived from the
 *   backend is ever revealed;
 * - `syncFull()` lets the authoritative `result` frame correct/complete the
 *   buffer (the accumulated deltas always equal it in practice);
 * - `flushAll()` is called at every terminal state, so the full received
 *   answer is guaranteed visible no matter how the run ends;
 * - the reveal rate adapts to the backlog so a long answer never lags
 *   minutes behind the model (base ≈ the prototype's 45ms/word feel).
 */

export interface AnswerPacer {
  /** Append real streamed text (gateway deltas). */
  push(text: string): void;
  /** Authoritative full content (the `result` frame) — never truncates. */
  syncFull(text: string): void;
  /** Reveal everything received immediately (terminal states). */
  flushAll(): void;
  /**
   * Keep the word-by-word rhythm until the buffer is fully revealed, then
   * invoke `onDone` (immediately when nothing is pending). Used on the
   * SUCCESS path so the typing effect finishes exactly like the prototype;
   * failure/stop paths use flushAll/dispose instead.
   */
  drain(onDone: () => void): void;
  /** True while a drain() completion is still pending (don't dispose yet). */
  isDraining(): boolean;
  /** Stop ticking (abort paths — content stays exactly as revealed). */
  dispose(): void;
}

/**
 * Reveal tick — the prototype's exact word rhythm (45ms/word). Catch-up
 * increases WORDS per tick, never the tick rate, so the persistence write
 * rate stays bounded while long backlogs still drain quickly.
 */
const TICK_MS = 45;
/** Base words revealed per tick (the prototype's stream() cadence). */
const BASE_WORDS_PER_TICK = 1;
/** Backlog (words) over which the reveal accelerates linearly. */
const CATCH_UP_HEADROOM_WORDS = 30;

export function createAnswerPacer(
  onReveal: (revealedText: string) => void,
): AnswerPacer {
  /** Everything the backend actually sent (deltas + synced final). */
  let received = "";
  /** How much of `received` has been revealed (word-boundary aligned). */
  let revealed = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Fractional word accumulator for smooth sub-word ticks. */
  let carry = 0;
  let disposed = false;
  /** drain() completion — invoked once the buffer is fully revealed. */
  let drainDone: (() => void) | null = null;

  const stop = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    if (disposed || timer !== null) return;
    timer = setTimeout(tick, TICK_MS);
  };

  /** Advance `revealed` past up to `words` words (whitespace-inclusive). */
  const advanceWords = (words: number): void => {
    let idx = revealed;
    let n = 0;
    while (n < words && idx < received.length) {
      // skip any whitespace run, then one word
      while (idx < received.length && /\s/.test(received[idx] as string)) idx += 1;
      while (idx < received.length && !/\s/.test(received[idx] as string)) idx += 1;
      n += 1;
    }
    revealed = Math.min(idx, received.length);
  };

  const countWords = (text: string): number => {
    let count = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i] as string;
      if (/\s/.test(ch)) {
        inWord = false;
      } else if (!inWord) {
        inWord = true;
        count += 1;
      }
    }
    return count;
  };

  const finishDrain = (): void => {
    const cb = drainDone;
    drainDone = null;
    if (cb) cb();
  };

  const tick = (): void => {
    timer = null;
    if (disposed) return;
    if (revealed >= received.length) {
      carry = 0;
      finishDrain();
      return; // nothing pending — restarts on the next push
    }
    const remainingWords = countWords(received.slice(revealed));
    if (remainingWords === 0) {
      // only trailing whitespace left — reveal it wholesale
      revealed = received.length;
      onReveal(received);
      carry = 0;
      finishDrain();
      return;
    }
    // adaptive speed: base rhythm, linear catch-up on large backlogs
    const speed = Math.max(
      BASE_WORDS_PER_TICK,
      remainingWords / CATCH_UP_HEADROOM_WORDS,
    );
    carry += speed;
    const whole = Math.floor(carry);
    if (whole < 1) {
      schedule();
      return;
    }
    carry -= whole;
    advanceWords(whole);
    onReveal(received.slice(0, revealed));
    if (revealed < received.length) schedule();
    else finishDrain();
  };

  return {
    push(text: string): void {
      if (disposed || !text) return;
      received += text;
      schedule();
    },
    syncFull(text: string): void {
      if (disposed) return;
      // The result frame is authoritative — grow (never shrink) the buffer.
      if (typeof text === "string" && text.length > received.length) {
        received = text;
        schedule();
      }
    },
    flushAll(): void {
      if (disposed) return;
      stop();
      drainDone = null;
      carry = 0;
      if (revealed < received.length) {
        revealed = received.length;
        onReveal(received);
      }
    },
    drain(onDone: () => void): void {
      if (disposed) {
        onDone();
        return;
      }
      drainDone = onDone;
      if (revealed >= received.length) {
        stop();
        finishDrain();
        return;
      }
      schedule();
    },
    isDraining(): boolean {
      return !disposed && drainDone !== null;
    },
    dispose(): void {
      disposed = true;
      stop();
    },
  };
}
