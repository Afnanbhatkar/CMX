import type { CodeMindEvent } from "@/server/events/types";

/**
 * CodeMind X V2 — job system contracts (Phase 3, spec §5).
 *
 * Redis-spec semantics on a SQLite-persisted in-process queue: job state is
 * the `analysis_jobs` row (DB is the source of truth), the in-process pump is
 * the local runtime, and Redis-backed workers remain [PLANNED] per
 * CAPABILITIES.md.
 */

/** Exact job state vocabulary (schema comment on analysis_jobs.status). */
export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

/** The 1..100 DB-write throttle window (percent points). */
export const PROGRESS_WRITE_DELTA = 1;

/** Heartbeat cadence for the RUNNING row (~5 s via control.progress writes). */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Control surface handed to a job handler. Pause/cancel are COOPERATIVE:
 * the handler polls them between units of work (e.g. between chunks) and
 * returns early when a stop was requested; `progress` persists stage/pct and
 * the resumable checkpoint.
 */
export interface JobControl {
  /** True when the job row has been externally set to PAUSED. */
  checkPause(): Promise<boolean>;
  /** True when the job row has been externally set to CANCELLED. */
  checkCancel(): Promise<boolean>;
  /**
   * Persist stage + progress (0..1) and, when given, the resumable checkpoint
   * payload. Writes are throttled (≥1 percent-point move, stage change, or
   * ~5 s heartbeat) and every checkpoint write also upserts an
   * analysis_checkpoints row (key "latest").
   */
  progress(stage: string, pct: number, checkpoint?: Record<string, unknown>): Promise<void>;
}

export interface JobHandlerContext {
  /** Internal AnalysisJob.id (never exposed in API responses). */
  jobId: string;
  /** Public job identifier (AnalysisJob.publicId) — the API-facing id. */
  publicId: string;
  /** Repository the job is scoped to, when the request named one. */
  repositoryId: string | null;
  /**
   * Job input payload (Phase 4): the JSON persisted on AnalysisJob.input,
   * parsed for the handler. Callers MUST strip credentials before enqueue
   * (Phase 4 import tokens live in the ephemeral vault, never in `input`).
   */
  input: unknown;
  control: JobControl;
  /** Typed event publisher (process-wide bus; labels only — spec §7). */
  publish: (event: CodeMindEvent) => void;
}

export type JobHandler = (ctx: JobHandlerContext) => Promise<void>;
