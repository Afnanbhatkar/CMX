import type { db } from "@/lib/db";
import type { JobStatus } from "./types";

/**
 * CodeMind X V2 — public job DTO serializer (Phase 3, spec §5).
 *
 * One consistent wire shape for every jobs route: POST /api/jobs,
 * GET /api/jobs, GET /api/jobs/[id], POST /api/jobs/[id]/control.
 * The internal AnalysisJob.id never appears — `jobId` is the publicId.
 */

export type AnalysisJobRow = NonNullable<Awaited<ReturnType<typeof db.analysisJob.findFirst>>>;

export interface JobDTO {
  /** AnalysisJob.publicId — the only externally visible job id. */
  jobId: string;
  type: string;
  /** QUEUED | RUNNING | PAUSED | CANCELLED | COMPLETED | FAILED */
  status: JobStatus | string;
  stage: string | null;
  /** 0..1 completion fraction. */
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  /** Sanitized failure message (single line, no stack) when FAILED. */
  error: string | null;
  createdAt: string;
}

export function serializeJob(row: AnalysisJobRow): JobDTO {
  return {
    jobId: row.publicId,
    type: row.type,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}
