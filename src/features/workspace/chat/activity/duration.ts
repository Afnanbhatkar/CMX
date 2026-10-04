"use client";

/**
 * CodeMind X V2 — activity-chain duration model (Phase 8D, spec A.7/A.8).
 *
 * ONE run-level active-work timer per run: it accumulates thinking + solving
 * time and EXCLUDES waiting (approval / user-input / paused states). The
 * timer is continuous across the Thinking → Solving transition and is frozen
 * at the FIRST final-answer chunk.
 *
 * Client elapsed timing uses performance.now() with an explicit paused-time
 * accumulator (spec A.3/A.7); server timestamps are preferred for row
 * history where the wire provides them.
 */

/** Mutable accumulator for one run's active-work time. */
export interface ActiveTimer {
  /** performance.now() of the current contiguous work segment. */
  segmentStart: number | null;
  /** Accumulated active ms (excluding every paused span). */
  accumulatedMs: number;
  /** True while the run is paused (waiting). */
  paused: boolean;
}

export function createActiveTimer(now: number): ActiveTimer {
  return { segmentStart: now, accumulatedMs: 0, paused: false };
}

/** Pause the active-work timer (waiting / approval / user-input). */
export function pauseTimer(timer: ActiveTimer, now: number): void {
  if (timer.paused) return;
  if (timer.segmentStart !== null) {
    timer.accumulatedMs += Math.max(0, now - timer.segmentStart);
    timer.segmentStart = null;
  }
  timer.paused = true;
}

/** Resume the active-work timer after a wait. */
export function resumeTimer(timer: ActiveTimer, now: number): void {
  if (!timer.paused) return;
  timer.segmentStart = now;
  timer.paused = false;
}

/** Read the current active-work total without stopping the timer. */
export function readTimer(timer: ActiveTimer, now: number): number {
  const live = timer.segmentStart !== null ? Math.max(0, now - timer.segmentStart) : 0;
  return timer.accumulatedMs + live;
}

/**
 * Freeze the timer at the end of active work (first final-answer chunk,
 * failure, or cancellation) and return the final active duration.
 */
export function finalizeTimer(timer: ActiveTimer, now: number): number {
  if (!timer.paused && timer.segmentStart !== null) {
    timer.accumulatedMs += Math.max(0, now - timer.segmentStart);
    timer.segmentStart = null;
  }
  return timer.accumulatedMs;
}

/**
 * Format an active duration for the final label (spec A.8):
 * - < 1s            → "<1s"  (never falsely rounded to 1s)
 * - < 60s           → "8s"
 * - 60s and above   → "1m 12s" / "2m 07s"
 */
export function formatActiveDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "<1s";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  // 59.6s rounding edge: 1m 00s is correct, never "1m 60s".
  if (seconds >= 60) {
    return `${minutes + 1}m 00s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
