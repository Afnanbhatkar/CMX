"use client";

/**
 * CodeMind X V2 — Phase 8 run adapter (Phase 8B update).
 *
 * Two ingestion paths, ONE engine:
 *
 * 1. Local helpers (runStarted/runActivityStarted/…) — honest client-side
 *    lifecycle reporting for paths where no backend stream exists yet.
 *
 * 2. `applyWireEvent` (Phase 8B) — applies sequenced events from the real
 *    streaming run surface (POST /api/assistant/runs) straight onto the
 *    ActivityEngine and records honest run metrics (first-event latency,
 *    event count, sequence gaps, measured duration, relevant categories).
 *    The backend is the single source of truth for the live run; nothing
 *    here invents activity the backend did not report.
 *
 * Deliberately NOT fabricated: RESPONSE_CHUNK traffic (the gateway has no
 * token streaming — one honest chunk arrives when the answer exists).
 */

import { assistantActivityEngine, emitAssistantEvent } from "./activity-engine";
import {
  DEFAULT_COMPOSER_MODE,
  type ActivityCategory,
  type ActivityNode,
  type SequencedAssistantEvent,
} from "./contracts";
import { selectRelevantCategories } from "./category-engine";

let runCounter = 0;

export function createRunId(): string {
  runCounter += 1;
  return `run-${Date.now().toString(36)}-${runCounter}`;
}

function now(): number {
  return Date.now();
}

export function runStarted(runId: string, conversationId: string | null): number {
  const startedAt = now();
  emitAssistantEvent({
    type: "RUN_STARTED",
    runId,
    conversationId,
    startedAt,
    mode: DEFAULT_COMPOSER_MODE,
  });
  return startedAt;
}

export function runActivityStarted(runId: string, node: Omit<ActivityNode, "status" | "startedAt" | "completedAt">): void {
  emitAssistantEvent({
    type: "ACTIVITY_STARTED",
    runId,
    activity: {
      ...node,
      status: "active",
      startedAt: now(),
      completedAt: null,
    },
  });
}

export function runActivityCompleted(runId: string, activityId: string, summary: string | null): void {
  emitAssistantEvent({
    type: "ACTIVITY_COMPLETED",
    runId,
    activityId,
    summary,
    completedAt: now(),
  });
}

export function runCompleted(runId: string): void {
  emitAssistantEvent({ type: "RUN_COMPLETED", runId, completedAt: now() });
  finalizeMetrics(runId);
}

export function runFailed(runId: string, error: string): void {
  emitAssistantEvent({ type: "RUN_FAILED", runId, error, failedAt: now() });
  finalizeMetrics(runId);
}

export function runCancelled(runId: string): void {
  emitAssistantEvent({ type: "RUN_CANCELLED", runId, cancelledAt: now() });
  finalizeMetrics(runId);
}

/** Sync metrics with the engine after a LOCAL terminal event (same module). */
function finalizeMetrics(runId: string): void {
  if (!metrics || metrics.runId !== runId) return;
  const after = assistantActivityEngine.getSnapshot();
  metrics.durationMs = after.durationMs;
  metrics.categories = selectRelevantCategories(after.activities);
  metrics.outcome = after.status;
}

/* ------------------------------------------------------------------ */
/* Wire ingestion + honest run metrics (Phase 8B)                      */
/* ------------------------------------------------------------------ */

/** Measured facts of the last wire-driven run (never invented). */
export interface AssistantRunMetrics {
  runId: string;
  mode: string;
  /** Client-measured ms from send() to the first parsed wire event. */
  firstEventMs: number | null;
  /** Total wire events applied for this run. */
  events: number;
  /** Last sequence number seen (monotonic per run, starts at 1). */
  lastSeq: number;
  /** Count of sequence gaps detected (defensive visibility). */
  seqGaps: number;
  /** Engine-measured run duration at the terminal event. */
  durationMs: number | null;
  /** Categories that actually ran (category engine selection). */
  categories: ActivityCategory[];
  /** Terminal state of the run. */
  outcome: "running" | "completed" | "failed" | "cancelled";
}

let metrics: AssistantRunMetrics | null = null;

/** Read-only access for verification tooling (window.__cmxAssistant). */
export function getLastRunMetrics(): AssistantRunMetrics | null {
  return metrics;
}

/**
 * Apply one sequenced wire event onto the engine and update the run
 * metrics. Sequence numbers are validated monotonically; a gap is counted
 * (never silently ignored) but never crashes the run.
 */
export function applyWireEvent(event: SequencedAssistantEvent): void {
  if (event.type === "RUN_STARTED") {
    metrics = {
      runId: event.runId,
      mode: event.mode,
      firstEventMs: null,
      events: 0,
      lastSeq: 0,
      seqGaps: 0,
      durationMs: null,
      categories: [],
      outcome: "running",
    };
  }

  if (metrics && event.runId === metrics.runId) {
    const expected = metrics.lastSeq + 1;
    if (event.seq !== expected) metrics.seqGaps += 1;
    metrics.lastSeq = Math.max(metrics.lastSeq, event.seq);
    metrics.events += 1;
  }

  assistantActivityEngine.applyEvent(event);

  const after = assistantActivityEngine.getSnapshot();
  if (metrics && event.runId === metrics.runId) {
    metrics.durationMs = after.durationMs;
    metrics.categories = selectRelevantCategories(after.activities);
    if (after.status === "completed" || after.status === "failed" || after.status === "cancelled") {
      metrics.outcome = after.status;
    }
  }
}

/** Record the client-measured first-event latency (called once per run). */
export function recordFirstEventLatency(runId: string, firstEventMs: number): void {
  if (metrics && metrics.runId === runId && metrics.firstEventMs === null) {
    metrics.firstEventMs = firstEventMs;
  }
}

/**
 * Account for transport-only frames (the `result` frame) that share the
 * run's sequence space but are not contract events — keeps gap detection
 * exact instead of flagging a false gap at every answer.
 */
export function noteTransportSeq(runId: string, seq: number): void {
  if (!metrics || metrics.runId !== runId) return;
  const expected = metrics.lastSeq + 1;
  // A contiguous transport frame consumes its own seq (no gap). A jump
  // means events were lost in transport — count the missing ones.
  if (seq > expected) metrics.seqGaps += seq - expected;
  if (seq > metrics.lastSeq) metrics.lastSeq = seq;
}
