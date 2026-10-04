"use client";

/**
 * CodeMind X V2 — ActivityEngine (Phase 8 §5/§10, minimal plumbing).
 *
 * The subsystem that sits between a user request and the AI response: it
 * ingests the typed streaming events (contracts.ts §13), enforces the
 * activity state machine, tracks real durations, and exposes an immutable
 * snapshot for React (useSyncExternalStore) and for verification tooling.
 *
 * Partition scope: this is the ENGINE ONLY. The 8B sub-phase owns the
 * user-facing visuals (Lattice loader, Thinking Orb, Thought Chain, category
 * activity). The engine never sees chain-of-thought — only safe summaries.
 *
 * Honesty:
 * - illegal state transitions are rejected (defensively — the engine records
 *   `lastRejection` instead of throwing, so a contract bug can never crash a
 *   live run);
 * - durations are measured, never invented;
 * - RESPONSE_CHUNK events are only applied when a backend really streams
 *   segments (none does today).
 */

import type {
  ActivityNode,
  ActivityStatus,
  ApprovalRequest,
  AssistantStreamEvent,
  ContextInspectorSnapshot,
  IntakeQuestionBatch,
  MemoryRecord,
  RunStatus,
} from "./contracts";
import { canTransition } from "./contracts";

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

export interface ActivityEngineSnapshot {
  /** null when no run has started yet. */
  runId: string | null;
  status: RunStatus;
  startedAt: number | null;
  endedAt: number | null;
  /** Real measured duration for terminal runs (never live-ticked). */
  durationMs: number | null;
  /** Activities in insertion order. */
  activities: ActivityNode[];
  fileReferences: { path: string; line: number | null }[];
  searchResults: { query: string; hits: number; topFiles: string[] }[];
  lastError: string | null;
  /** Honest record of the last rejected event (contract bugs stay visible). */
  lastRejection: string | null;
  /* ---- 8C additions — the context/approval/question surfaces ---- */
  /** The measured context snapshot the backend emitted (CONTEXT_SNAPSHOT). */
  contextSnapshot: ContextInspectorSnapshot | null;
  /** Real retrieved memory records (MEMORY_USED) — empty when none matched. */
  memories: MemoryRecord[];
  /** Honest note when no memory applied. */
  memoryNote: string | null;
  /** Approval requests emitted by the run (APPROVAL_REQUIRED). */
  approvals: ApprovalRequest[];
  /** The active intake question batch while the run is paused (8C question flow). */
  questionBatch: IntakeQuestionBatch | null;
}

const EMPTY_SNAPSHOT: ActivityEngineSnapshot = {
  runId: null,
  status: "idle",
  startedAt: null,
  endedAt: null,
  durationMs: null,
  activities: [],
  fileReferences: [],
  searchResults: [],
  lastError: null,
  lastRejection: null,
  contextSnapshot: null,
  memories: [],
  memoryNote: null,
  approvals: [],
  questionBatch: null,
};

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class AssistantActivityEngine {
  private state: ActivityEngineSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ActivityEngineSnapshot => this.state;

  /** Begin a new run (resets any previous one — one run at a time, honest). */
  startRun(runId: string, startedAt: number): void {
    this.state = {
      ...EMPTY_SNAPSHOT,
      runId,
      status: "running",
      startedAt,
    };
    this.emit();
  }

  activityStart(node: ActivityNode): void {
    if (this.state.status !== "running" && this.state.status !== "awaiting-answers") {
      this.reject(`ACTIVITY_STARTED outside a running run (${node.id})`);
      return;
    }
    if (this.state.activities.some((a) => a.id === node.id)) {
      this.reject(`duplicate activity id ${node.id}`);
      return;
    }
    this.state = {
      ...this.state,
      activities: [...this.state.activities, { ...node }],
    };
    this.emit();
  }

  activityTransition(activityId: string, to: ActivityStatus, patch?: Partial<ActivityNode>, endedAt?: number): void {
    const current = this.state.activities.find((a) => a.id === activityId);
    if (!current) {
      this.reject(`unknown activity ${activityId}`);
      return;
    }
    if (!canTransition(current.status, to)) {
      this.reject(`illegal transition ${current.status} → ${to} for ${activityId}`);
      return;
    }
    this.state = {
      ...this.state,
      activities: this.state.activities.map((a) =>
        a.id === activityId
          ? {
              ...a,
              ...patch,
              status: to,
              completedAt: to === "completed" || to === "failed" || to === "cancelled" ? endedAt ?? Date.now() : a.completedAt,
            }
          : a,
      ),
    };
    this.emit();
  }

  fileReferenced(path: string, line: number | null): void {
    if (this.state.status !== "running" && this.state.status !== "awaiting-answers") {
      this.reject(`FILE_REFERENCED outside a running run (${path})`);
      return;
    }
    if (this.state.fileReferences.some((f) => f.path === path && f.line === line)) return;
    this.state = {
      ...this.state,
      fileReferences: [...this.state.fileReferences, { path, line }],
    };
    this.emit();
  }

  searchResult(query: string, hits: number, topFiles: string[]): void {
    if (this.state.status !== "running" && this.state.status !== "awaiting-answers") {
      this.reject("SEARCH_RESULT outside a running run");
      return;
    }
    this.state = {
      ...this.state,
      searchResults: [...this.state.searchResults, { query, hits, topFiles }],
    };
    this.emit();
  }

  completeRun(completedAt: number): void {
    if (this.state.status !== "running" && this.state.status !== "awaiting-answers") {
      this.reject(`RUN_COMPLETED while ${this.state.status}`);
      return;
    }
    this.state = {
      ...this.state,
      status: "completed",
      endedAt: completedAt,
      durationMs: this.state.startedAt !== null ? Math.max(0, completedAt - this.state.startedAt) : null,
    };
    this.emit();
  }

  failRun(error: string, failedAt: number): void {
    if (this.state.status !== "running" && this.state.status !== "awaiting-answers") {
      this.reject(`RUN_FAILED while ${this.state.status}`);
      return;
    }
    this.state = {
      ...this.state,
      status: "failed",
      endedAt: failedAt,
      durationMs: this.state.startedAt !== null ? Math.max(0, failedAt - this.state.startedAt) : null,
      lastError: error,
    };
    this.emit();
  }

  cancelRun(cancelledAt: number): void {
    if (this.state.status !== "running" && this.state.status !== "awaiting-answers") {
      this.reject(`RUN_CANCELLED while ${this.state.status}`);
      return;
    }
    this.state = {
      ...this.state,
      status: "cancelled",
      endedAt: cancelledAt,
      durationMs: this.state.startedAt !== null ? Math.max(0, cancelledAt - this.state.startedAt) : null,
    };
    this.emit();
  }

  /* ---------------- 8C: context / memory / approval / question flow ------- */

  /** Record the measured context snapshot emitted by the backend. */
  setContextSnapshot(snapshot: ContextInspectorSnapshot): void {
    this.state = { ...this.state, contextSnapshot: snapshot };
    this.emit();
  }

  /** Record real retrieved memory records (or the honest none-matched note). */
  setMemories(memories: MemoryRecord[], note: string | null): void {
    this.state = { ...this.state, memories, memoryNote: note };
    this.emit();
  }

  /** Record an approval request (what will change, risk, permissions…). */
  addApproval(approval: ApprovalRequest): void {
    if (this.state.approvals.some((a) => a.id === approval.id)) return;
    this.state = { ...this.state, approvals: [...this.state.approvals, approval] };
    this.emit();
  }

  /**
   * Pause the run for material questions (8C question flow). The run stays
   * on the wire; it resumes ONLY when the user answers.
   */
  pauseForQuestions(batch: IntakeQuestionBatch): void {
    if (this.state.status !== "running") {
      this.reject(`INTAKE_QUESTIONS_REQUIRED while ${this.state.status}`);
      return;
    }
    this.state = { ...this.state, status: "awaiting-answers", questionBatch: batch };
    this.emit();
  }

  /**
   * Resume after the user answered. Activity events arriving while paused
   * also implicitly resume (defensive against answer/stream races).
   */
  resumeFromAwaiting(): void {
    if (this.state.status !== "awaiting-answers") return;
    this.state = { ...this.state, status: "running", questionBatch: null };
    this.emit();
  }

  /** Apply any contract event to the engine — the single ingestion route. */
  applyEvent(event: AssistantStreamEvent): void {
    if (
      event.type !== "RUN_STARTED" &&
      event.runId !== this.state.runId &&
      // CONTEXT_SNAPSHOT/MEMORY_USED may legally arrive for a run whose
      // RUN_STARTED frame raced ahead — they are per-run facts, not lifecycle.
      event.type !== "CONTEXT_SNAPSHOT" &&
      event.type !== "MEMORY_USED"
    ) {
      this.reject(`${event.type} for foreign run ${event.runId}`);
      return;
    }
    switch (event.type) {
      case "RUN_STARTED":
        this.startRun(event.runId, event.startedAt);
        break;
      case "ACTIVITY_STARTED":
        this.activityStart(event.activity);
        break;
      case "ACTIVITY_UPDATED":
        if (event.patch.status) {
          // Only forward explicitly-provided keys — undefined must never
          // clobber an existing value.
          const patch: Partial<ActivityNode> = {};
          if (event.patch.title !== undefined) patch.title = event.patch.title;
          if (event.patch.summary !== undefined) patch.summary = event.patch.summary;
          if (event.patch.metadata !== undefined) patch.metadata = event.patch.metadata;
          this.activityTransition(event.activityId, event.patch.status, patch);
        } else {
          this.state = {
            ...this.state,
            activities: this.state.activities.map((a) =>
              a.id === event.activityId
                ? {
                    ...a,
                    title: event.patch.title ?? a.title,
                    summary: event.patch.summary ?? a.summary,
                    metadata: event.patch.metadata ?? a.metadata,
                  }
                : a,
            ),
          };
          this.emit();
        }
        break;
      case "ACTIVITY_COMPLETED":
        this.activityTransition(event.activityId, "completed", { summary: event.summary }, event.completedAt);
        break;
      case "FILE_REFERENCED":
        this.fileReferenced(event.path, event.line);
        break;
      case "SEARCH_RESULT":
        this.searchResult(event.query, event.hits, event.topFiles);
        break;
      case "CONTEXT_SNAPSHOT":
        this.setContextSnapshot(event.snapshot);
        break;
      case "MEMORY_USED":
        this.setMemories(event.memories, event.note);
        break;
      case "INTAKE_QUESTIONS_REQUIRED":
        this.pauseForQuestions(event.batch);
        break;
      case "APPROVAL_REQUIRED":
        this.addApproval(event.approval);
        break;
      case "QUESTION_REQUIRED":
      case "RESPONSE_CHUNK":
        // Single mid-run questions and segment rendering are 8.5 surfaces;
        // 8C consumes the batched intake flow instead. Honest no-op here.
        break;
      case "RUN_COMPLETED":
        this.completeRun(event.completedAt);
        break;
      case "RUN_FAILED":
        this.failRun(event.error, event.failedAt);
        break;
      case "RUN_CANCELLED":
        this.cancelRun(event.cancelledAt);
        break;
    }
  }

  /* ---------------- internals ---------------- */

  private reject(reason: string): void {
    this.state = { ...this.state, lastRejection: reason };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/* ------------------------------------------------------------------ */
/* Module singleton + React binding                                    */
/* ------------------------------------------------------------------ */

/** One engine per app — assistant runs are serialized (Phase 2 contract). */
export const assistantActivityEngine = new AssistantActivityEngine();

/**
 * Apply-and-forward helper for run adapters: keeps the engine's event
 * vocabulary as the ONLY way the run lifecycle is reported.
 */
export function emitAssistantEvent(event: AssistantStreamEvent): void {
  assistantActivityEngine.applyEvent(event);
}
