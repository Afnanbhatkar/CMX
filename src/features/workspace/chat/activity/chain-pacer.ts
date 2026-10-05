"use client";

/**
 * CodeMind X V2 — activity chain display pacer (Phase 9).
 *
 * The prototype's "realness" comes from RHYTHM: the Thinking header is
 * visible on its own for ~1s, then each step appears one by one and stays
 * visibly "running" before the next arrives. The real backend emits the
 * same events but often milliseconds apart (Understanding starts and
 * completes almost instantly), which makes the chain flash instead of tell
 * a story.
 *
 * This pacer applies DISPLAY smoothing to the REAL sequenced events before
 * they enter the activity-chain store:
 * - every event is still ingested, exactly once, in wire order — only its
 *   VISIBLE timing is smoothed (the same technique every agent UI uses);
 * - the engine (`applyWireEvent`) and message metadata are updated
 *   immediately by the caller — only the chain store waits;
 * - timing minimums, never artificial delays: natural backend spacing
 *   always wins when it is larger;
 * - RESPONSE_CHUNK, intake/approval, and terminal events are NEVER delayed
 *   — a pending queue is flushed first so the chain is complete and
 *   consistent before the answer streams or the run pauses/ends.
 *
 * Rhythm (matching the prototype scenarios):
 *   Thinking alone ≈ 0.9s → step 1 appears → each step ≥ 0.45s apart →
 *   each step visibly "runs" ≥ 0.7s before completing → result/file
 *   children cascade in ~60ms apart.
 */

import type { SequencedAssistantEvent } from "../../assistant/contracts";
import { ingestRunActivityEvent } from "./run-activity-store";

/** The Thinking header is visible on its own before the first step. */
const FIRST_STEP_DELAY_MS = 900;
/** Minimum visible gap between two consecutive step rows. */
const MIN_STEP_GAP_MS = 450;
/** Minimum time a step row stays visibly "running" before completing. */
const MIN_DWELL_MS = 700;
/** Cascade gap for search-result / file-referenced child updates. */
const CHILD_GAP_MS = 60;

export interface ChainPacer {
  /** Feed one real wire event (call for EVERY event, in arrival order). */
  ingest(event: SequencedAssistantEvent): void;
  /** Release everything pending immediately, in order. */
  flushAll(): void;
  /** True while events are still queued (pending display work). */
  isBusy(): boolean;
  /** Drop pending events without releasing (component teardown). */
  dispose(): void;
}

type EventTiming = "start" | "settle" | "child" | "immediate";

function timingOf(event: SequencedAssistantEvent): EventTiming {
  switch (event.type) {
    case "ACTIVITY_STARTED":
      return "start";
    case "ACTIVITY_COMPLETED":
    case "ACTIVITY_UPDATED":
      return "settle";
    case "SEARCH_RESULT":
    case "FILE_REFERENCED":
      return "child";
    default:
      // RESPONSE_CHUNK, RUN_*, intake, approval, context, memory — immediate
      // (ingest flushes any pending queue first, keeping global order).
      return "immediate";
  }
}

export function createChainPacer(): ChainPacer {
  const pending: { event: SequencedAssistantEvent; releaseAt: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  let runStartAt: number | null = null;
  /** Release time of the last ACTIVITY_STARTED (step-gap anchor). */
  let lastStartReleaseAt = -Infinity;
  /** Release time of the most recently QUEUED or released start — two starts
   * arriving in the same network batch must still stagger apart. */
  let lastQueuedStartAt = -Infinity;
  /** Release time of the last released event of any paced kind. */
  let lastReleaseAt = -Infinity;
  /** activityId → when its START row became visible (dwell anchor). */
  const startVisibleAt = new Map<string, number>();
  /** The FIRST RESPONSE_CHUNK is the chain-close moment — it may be queued
   * behind the story on very fast runs; later chunks are store no-ops. */
  let firstChunkSeen = false;

  const releaseOne = (event: SequencedAssistantEvent): void => {
    const now = performance.now();
    if (event.type === "ACTIVITY_STARTED") {
      const activity = (event as { activity?: { id?: string } }).activity;
      if (activity && typeof activity.id === "string") {
        startVisibleAt.set(activity.id, now);
      }
      lastStartReleaseAt = now;
    }
    lastReleaseAt = now;
    ingestRunActivityEvent(event);
  };

  const schedule = (): void => {
    if (disposed || timer !== null || pending.length === 0) return;
    const earliest = pending.reduce(
      (min, item) => Math.min(min, item.releaseAt),
      Infinity,
    );
    const delay = Math.max(0, earliest - performance.now());
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      // Release everything due (in arrival order), rescheduling for the rest.
      const now = performance.now();
      const due: SequencedAssistantEvent[] = [];
      let index = 0;
      while (index < pending.length && pending[index]!.releaseAt <= now) {
        due.push(pending[index]!.event);
        index += 1;
      }
      pending.splice(0, index);
      for (const event of due) releaseOne(event);
      if (pending.length > 0) schedule();
    }, delay);
  };

  const flushAll = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    while (pending.length > 0) {
      const item = pending.shift();
      if (item) releaseOne(item.event);
    }
  };

  const queueAt = (event: SequencedAssistantEvent, releaseAt: number): void => {
    pending.push({ event, releaseAt });
    pending.sort((a, b) => a.releaseAt - b.releaseAt);
    schedule();
  };

  /** Release time of the last queued event (or now when idle). */
  const lastPendingTime = (): number =>
    pending.length > 0
      ? pending.reduce((max, item) => Math.max(max, item.releaseAt), 0)
      : performance.now();

  return {
    ingest(event: SequencedAssistantEvent): void {
      if (disposed) return;

      if (event.type === "RUN_STARTED") {
        // Anchor FIRST — every pacing minimum below is relative to it.
        runStartAt = performance.now();
        releaseOne(event);
        return;
      }

      /* ---- Chain-close + terminal on very fast runs ----
       * The first RESPONSE_CHUNK finalizes the work phase (final label +
       * auto-collapse) and RUN_COMPLETED settles the run. When the backend
       * is FASTER than the story's pacing minimums, these would fire before
       * the first step is even visible and flush-dump the whole timeline.
       * They are queued behind the story instead — the answer itself still
       * streams immediately (the reveal pacer is fed BEFORE this store
       * ingest), so only the chain-close moment is gently delayed, never
       * the answer. Failures/cancels stay blunt and immediate. */
      if (event.type === "RESPONSE_CHUNK") {
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          if (pending.length > 0) {
            queueAt(event, lastPendingTime() + CHILD_GAP_MS);
            return;
          }
        }
        releaseOne(event);
        return;
      }
      if (event.type === "RUN_COMPLETED" && pending.length > 0) {
        queueAt(event, lastPendingTime() + 300);
        return;
      }

      const timing = timingOf(event);

      if (timing === "immediate") {
        // The chain must be consistent before the run pauses or ends —
        // flush first, then ingest now.
        flushAll();
        releaseOne(event);
        return;
      }

      const now = performance.now();
      let releaseAt = now;

      if (timing === "start") {
        releaseAt = Math.max(
          releaseAt,
          runStartAt !== null ? runStartAt + FIRST_STEP_DELAY_MS : now,
          lastStartReleaseAt + MIN_STEP_GAP_MS,
          lastQueuedStartAt + MIN_STEP_GAP_MS,
        );
        lastQueuedStartAt = releaseAt;
      } else if (timing === "settle") {
        const activityId =
          (event as { activityId?: string }).activityId ?? "";
        const visibleAt = startVisibleAt.get(activityId);
        releaseAt = Math.max(
          releaseAt,
          visibleAt !== undefined ? visibleAt + MIN_DWELL_MS : now,
        );
      } else {
        // child — cascades right after whatever precedes it: after the last
        // released event, never before the earliest queued predecessor
        // (its host row must be visible first), and never before the
        // thinking-only period.
        releaseAt = Math.max(
          releaseAt,
          pending.length > 0
            ? lastPendingTime() + CHILD_GAP_MS
            : lastReleaseAt + CHILD_GAP_MS,
          runStartAt !== null ? runStartAt + FIRST_STEP_DELAY_MS : now,
        );
      }

      // Natural spacing wins: an event that already arrived later than its
      // minimum releases immediately (no artificial waiting).
      pending.push({ event, releaseAt });
      pending.sort((a, b) => a.releaseAt - b.releaseAt);
      schedule();
    },
    flushAll,
    isBusy(): boolean {
      return pending.length > 0;
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.length = 0;
    },
  };
}
