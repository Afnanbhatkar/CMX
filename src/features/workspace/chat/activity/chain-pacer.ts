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
 *   consistent before the answer streams or the run pauses/ends;
 * - CONTEXT_SNAPSHOT / MEMORY_USED are chain no-ops (metadata only): they
 *   ingest immediately but NEVER flush the queue — flushing them would dump
 *   the whole queued story in one frame and kill the one-by-one entrance
 *   rhythm (they arrive right after the read events on every real run).
 *
 * Rhythm (matching the prototype scenarios, Phase 9.6 speed fix — the user
 * demanded fast phase transitions "in less secs": every minimum below was
 * measured as dead wait on top of real backend work, so the story keeps its
 * one-by-one readability at roughly double speed):
 *   Thinking alone ≈ 0.45s → step 1 appears → each step ≥ 0.22s apart →
 *   each step visibly "runs" ≥ 0.32s before completing → result/file rows
 *   cascade in one-by-one ~90ms apart (fast, but every row is readable).
 */

import type { SequencedAssistantEvent } from "../../assistant/contracts";
import { ingestRunActivityEvent } from "./run-activity-store";

export interface ChainPacerOptions {
  /**
   * Fired EXACTLY ONCE when the first RESPONSE_CHUNK is released into the
   * chain store — the moment the thought chain has finished telling its
   * story (the chunk is queued behind every pending row, so this fires
   * after the whole one-by-one sequence, right as the chain closes and the
   * final "Thought for Xs" label lands).
   *
   * User direction (Phase 9.1): the answer WRITING must start only after
   * the full thought chain completes — never while rows are still appearing
   * ("writing right after Searching repository looks wrong"). The caller
   * buffers streamed answer text until this fires, then starts the reveal.
   */
  onAnswerReady?: () => void;
}

/** The Thinking header is visible on its own before the first step. */
const FIRST_STEP_DELAY_MS = 450;
/** Minimum visible gap between two consecutive step rows. */
const MIN_STEP_GAP_MS = 220;
/** Minimum time a step row stays visibly "running" before completing. */
const MIN_DWELL_MS = 320;
/** Cascade gap for search-result / file rows — quick (many files stay
 *  brisk, per the user: "speed thodi zyada chalega"), but every row is
 *  visibly its own one-by-one appearance, never a blur. */
const CHILD_GAP_MS = 90;

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

type EventTiming = "start" | "settle" | "child" | "metadata" | "immediate";

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
    case "CONTEXT_SNAPSHOT":
    case "MEMORY_USED":
      // Chain no-ops (consumed by the Context Inspector / memory chip, not
      // rows). They arrive mid-story on EVERY real run — right after the
      // read events — so they must pass through WITHOUT flushing the queued
      // story; flushing here dumped Understanding+Searching+Read N files in
      // a single frame and erased the one-by-one entrance animation.
      return "metadata";
    default:
      // RESPONSE_CHUNK, RUN_*, intake, approval — immediate (ingest flushes
      // any pending queue first, keeping global order).
      return "immediate";
  }
}

export function createChainPacer(options: ChainPacerOptions = {}): ChainPacer {
  const { onAnswerReady } = options;
  const pending: { event: SequencedAssistantEvent; releaseAt: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  /** onAnswerReady fires once — at the first chunk's actual release. */
  let answerReadyFired = false;
  const fireAnswerReady = (): void => {
    if (answerReadyFired) return;
    answerReadyFired = true;
    onAnswerReady?.();
  };

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
  /** Release time assigned to the first chunk (null = released at once).
   * Later chunks must never overtake a still-queued first chunk — the first
   * one freezes the run timer, so an early release would shrink the final
   * duration label ("Thought for <1s" instead of the story's duration). */
  let firstChunkReleaseAt: number | null = null;

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
    // The first chunk's release IS the chain-close moment — whether it
    // released on schedule, immediately (no story) or via flushAll().
    if (event.type === "RESPONSE_CHUNK") fireAnswerReady();
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

  /** Gap between beats once the answer has started (wrap-up compression).
   *  150ms keeps the closing rows readable one-by-one (never an
   *  "all at once" blur) at the user-mandated fast pace. */
  const WRAP_UP_GAP_MS = 150;

  /**
   * Wrap-up compression: the first answer chunk arrived while story events
   * are still queued — shorten the remaining tail so the chain closes right
   * after the answer begins (no "the chip lands seconds later" lag). Order
   * is preserved; an ACTIVITY_STARTED never releases before the
   * thinking-only period (runStartAt + FIRST_STEP_DELAY) so the "Thinking
   * alone ≈ 1s" beat always survives the compression.
   */
  const compressPending = (): void => {
    if (pending.length === 0) return;
    let previous = performance.now();
    for (const item of pending) {
      const floor =
        item.event.type === "ACTIVITY_STARTED" && runStartAt !== null
          ? runStartAt + FIRST_STEP_DELAY_MS
          : 0;
      const target = Math.max(floor, previous + WRAP_UP_GAP_MS);
      item.releaseAt = target;
      previous = target;
    }
    pending.sort((a, b) => a.releaseAt - b.releaseAt);
  };

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
            // The answer is starting — wrap the remaining story up briskly
            // so the chain closes and the final duration chip lands right
            // behind it (never seconds later).
            compressPending();
            firstChunkReleaseAt = lastPendingTime() + CHILD_GAP_MS;
            queueAt(event, firstChunkReleaseAt);
            return;
          }
          releaseOne(event);
          return;
        }
        if (firstChunkReleaseAt !== null) {
          // Still queued behind the story — keep later chunks behind it.
          queueAt(event, firstChunkReleaseAt + 1);
          return;
        }
        releaseOne(event);
        return;
      }
      if (event.type === "RUN_COMPLETED" && pending.length > 0) {
        queueAt(event, lastPendingTime() + 300);
        return;
      }

      const timing = timingOf(event);

      if (timing === "metadata") {
        // Pass-through: the store treats these as no-ops for rows, so
        // releasing them ahead of the still-queued story is order-safe —
        // and the story keeps its paced one-by-one entrance.
        releaseOne(event);
        return;
      }

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
          // ORDERING GUARD: a start must never release ahead of story rows
          // that are still queued — on fast backends "Preparing response"
          // otherwise jumps in FRONT of the still-cascading file rows and
          // the timeline reads Reading → Preparing → Reading … instead of
          // the backend's true order (all file ops, then composing).
          pending.length > 0 ? lastPendingTime() + CHILD_GAP_MS : 0,
        );
        lastQueuedStartAt = releaseAt;
      } else if (timing === "settle") {
        const activityId =
          (event as { activityId?: string }).activityId ?? "";
        const visibleAt = startVisibleAt.get(activityId);
        // ORDERING GUARD: the completion must never release before its own
        // start row is visible. If the start is still queued (fast backend),
        // the completion would find no row and be swallowed — so floor it
        // just behind the queued start.
        const queuedStart = pending.find(
          (item) =>
            item.event.type === "ACTIVITY_STARTED" &&
            (item.event as { activity?: { id?: unknown } }).activity?.id ===
              activityId,
        );
        releaseAt = Math.max(
          releaseAt,
          visibleAt !== undefined ? visibleAt + MIN_DWELL_MS : now,
          queuedStart ? queuedStart.releaseAt + 60 : 0,
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
