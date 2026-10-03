"use client";

/**
 * CodeMind X V2 — Phase 8 run adapter (minimal plumbing).
 *
 * Adapts the CURRENT single-shot assistant run (POST /api/ai/chat) onto the
 * Phase 8 streaming-event contract. Everything emitted here is TRUE today:
 * - RUN_STARTED / RUN_COMPLETED / RUN_FAILED / RUN_CANCELLED with real times,
 * - the two honest activity steps the run genuinely performs
 *   (understanding the request, composing the response),
 * - measured durations.
 *
 * Deliberately NOT emitted: RESPONSE_CHUNK (no real streaming exists — a
 * single-shot answer is never re-dressed as chunked streaming), FILE_REFERENCED
 * and SEARCH_RESULT (those arrive with the 8.5 response engine / tool runs).
 */

import { emitAssistantEvent } from "./activity-engine";
import { DEFAULT_COMPOSER_MODE, type ActivityNode } from "./contracts";

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
}

export function runFailed(runId: string, error: string): void {
  emitAssistantEvent({ type: "RUN_FAILED", runId, error, failedAt: now() });
}

export function runCancelled(runId: string): void {
  emitAssistantEvent({ type: "RUN_CANCELLED", runId, cancelledAt: now() });
}
