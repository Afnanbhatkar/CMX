import { db } from "@/lib/db";
import { ApiError } from "@/server/api/envelope";
import { publish } from "@/server/events/bus";
import { createEvent } from "@/server/events/types";
import { logError } from "@/server/security/logger";

import { getJobHandler, listRegisteredJobTypes } from "./registry";
import type { AnalysisJobRow } from "./serialize";
import { HEARTBEAT_INTERVAL_MS, PROGRESS_WRITE_DELTA, type JobControl, type JobHandler } from "./types";

/**
 * CodeMind X V2 — persisted job queue (Phase 3, spec §5).
 *
 * Redis-spec semantics with SQLite persistence: every state transition is a
 * write to the `analysis_jobs` row (DB is the source of truth), an in-process
 * pump runs one job at a time, and Redis-backed workers remain [PLANNED] per
 * CAPABILITIES.md ("in-process queue + DB rows is the local runtime").
 *
 * Lifecycle:
 *   enqueue → QUEUED ──▶ RUNNING ──▶ COMPLETED
 *                        │  ▲          (terminal)
 *          pause ────────┼──┘
 *                        ├──▶ PAUSED ──resume──▶ QUEUED
 *                        ├──▶ CANCELLED (external, observed at next check)
 *        handler throws ─┴──▶ FAILED (sanitized error, no stack)
 *
 * Control checks are COOPERATIVE: pause/cancel set the row externally and the
 * running handler observes it at its next checkPause/checkCancel between
 * units of work. Progress/checkpoint writes are throttled (≥1 percent-point
 * move, stage change, checkpoint change, or ~5 s heartbeat) and every
 * checkpoint write also upserts an analysis_checkpoints row (key "latest").
 *
 * Honesty: queue operations wrap storage failures into SERVICE_UNAVAILABLE
 * envelope errors upstream (never silent), and the pump logs every internal
 * failure server-side.
 */

const RUNNING_STATUSES = ["QUEUED", "RUNNING"] as const;
const CANCELLABLE_STATUSES = ["QUEUED", "RUNNING", "PAUSED"] as const;

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Parse the persisted AnalysisJob.input JSON (Phase 4); corrupt → undefined. */
function parseJobInput(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Single-line, length-capped, stack-free message for the error column. */
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 500) || "Unknown job failure.";
}

class JobQueue {
  /** Set while the drain loop owns the process' single execution slot. */
  private pumping = false;

  /* ---------------------------------------------------------------- */
  /* Public queue operations (route-facing; envelope-honest errors)    */
  /* ---------------------------------------------------------------- */

  /** Create a QUEUED job row, publish JOB_QUEUED, kick the pump, return the row.
   *
   * Phase 4: `input` (optional JSON payload) is persisted verbatim on
   * AnalysisJob.input and handed to the handler as ctx.input. Callers MUST
   * strip credentials first — Phase 4 import tokens ride the ephemeral
   * token vault, never this column.
   */
  async enqueueJob(input: {
    type: string;
    repositoryId?: string | null;
    input?: Record<string, unknown> | null;
  }): Promise<AnalysisJobRow> {
    return this.withStorage("enqueue", async () => {
      if (!getJobHandler(input.type)) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Unknown job type "${input.type}". Registered types: ${listRegisteredJobTypes().join(", ") || "none"}.`,
          422,
        );
      }

      const row = await db.analysisJob.create({
        data: {
          type: input.type,
          repositoryId: input.repositoryId ?? null,
          input: input.input ? JSON.stringify(input.input) : null,
          status: "QUEUED",
        },
      });

      publish(
        createEvent({
          type: "JOB_QUEUED",
          jobId: row.publicId,
          jobType: row.type,
          stage: "queued",
          progress: 0,
        }),
      );

      this.kickPump();
      return row;
    });
  }

  /** QUEUED/RUNNING → PAUSED. Running handlers observe it at their next check. */
  async pauseJob(publicId: string): Promise<AnalysisJobRow> {
    return this.withStorage("pause", async () => {
      const row = await this.requireJob(publicId);
      if (!RUNNING_STATUSES.includes(row.status as (typeof RUNNING_STATUSES)[number])) {
        throw new ApiError(
          "CONFLICT",
          `Job is ${row.status}; pause is only valid from QUEUED or RUNNING.`,
          409,
        );
      }
      const updated = await db.analysisJob.updateMany({
        where: { id: row.id, status: { in: [...RUNNING_STATUSES] } },
        data: { status: "PAUSED" },
      });
      if (updated.count === 0) {
        throw new ApiError("CONFLICT", "Job state changed concurrently; retry.", 409);
      }
      publish(
        createEvent({
          type: "JOB_PAUSED",
          jobId: row.publicId,
          jobType: row.type,
          stage: row.stage ?? undefined,
          progress: row.progress,
        }),
      );
      return (await db.analysisJob.findUnique({ where: { id: row.id } }))!;
    });
  }

  /** PAUSED → QUEUED (progress/checkpoint preserved), then pump. */
  async resumeJob(publicId: string): Promise<AnalysisJobRow> {
    return this.withStorage("resume", async () => {
      const row = await this.requireJob(publicId);
      if (row.status !== "PAUSED") {
        throw new ApiError("CONFLICT", `Job is ${row.status}; only PAUSED jobs can resume.`, 409);
      }
      const updated = await db.analysisJob.updateMany({
        where: { id: row.id, status: "PAUSED" },
        data: { status: "QUEUED" },
      });
      if (updated.count === 0) {
        throw new ApiError("CONFLICT", "Job state changed concurrently; retry.", 409);
      }
      publish(
        createEvent({
          type: "JOB_QUEUED",
          jobId: row.publicId,
          jobType: row.type,
          stage: "queued",
          progress: row.progress,
        }),
      );
      this.kickPump();
      return (await db.analysisJob.findUnique({ where: { id: row.id } }))!;
    });
  }

  /** QUEUED/RUNNING/PAUSED → CANCELLED (terminal). */
  async cancelJob(publicId: string): Promise<AnalysisJobRow> {
    return this.withStorage("cancel", async () => {
      const row = await this.requireJob(publicId);
      if (!CANCELLABLE_STATUSES.includes(row.status as (typeof CANCELLABLE_STATUSES)[number])) {
        throw new ApiError(
          "CONFLICT",
          `Job is ${row.status}; cancel is only valid from QUEUED, RUNNING or PAUSED.`,
          409,
        );
      }
      const updated = await db.analysisJob.updateMany({
        where: { id: row.id, status: { in: [...CANCELLABLE_STATUSES] } },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ApiError("CONFLICT", "Job state changed concurrently; retry.", 409);
      }
      publish(
        createEvent({
          type: "JOB_CANCELLED",
          jobId: row.publicId,
          jobType: row.type,
          stage: row.stage ?? undefined,
          progress: row.progress,
        }),
      );
      return (await db.analysisJob.findUnique({ where: { id: row.id } }))!;
    });
  }

  /** One job by publicId, or the honest 404 envelope error. */
  async getJobByPublicId(publicId: string): Promise<AnalysisJobRow> {
    return this.withStorage("get", async () => this.requireJob(publicId));
  }

  /** Most recent jobs, newest first. */
  async listRecentJobs(limit = 20): Promise<AnalysisJobRow[]> {
    return this.withStorage("list", () =>
      db.analysisJob.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Pump                                                              */
  /* ---------------------------------------------------------------- */

  /** Fire-and-forget pump kick; pump logs its own failures, never silent. */
  drain(): void {
    void this.pump();
  }

  private kickPump(): void {
    void this.pump();
  }

  /**
   * Drain loop: while this process holds the single execution slot, claim the
   * oldest QUEUED job and run it. Re-entrant calls (enqueue/pump from other
   * request handlers) return immediately; the running loop picks up new work.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const next = await db.analysisJob.findFirst({
          where: { status: "QUEUED" },
          orderBy: { createdAt: "asc" },
        });
        if (!next) break;

        const handler = getJobHandler(next.type);
        if (!handler) {
          // Honest terminal state for jobs whose handler is gone (e.g. a
          // restart re-queued a type this runtime does not register).
          const failed = await db.analysisJob.updateMany({
            where: { id: next.id, status: "QUEUED" },
            data: {
              status: "FAILED",
              error: "handler not registered in this runtime",
              completedAt: new Date(),
            },
          });
          if (failed.count > 0) {
            publish(
              createEvent({
                type: "JOB_FAILED",
                jobId: next.publicId,
                jobType: next.type,
                stage: next.stage ?? undefined,
                progress: next.progress,
                error: "handler not registered in this runtime",
              }),
            );
          }
          continue;
        }

        // Conditional claim: QUEUED → RUNNING (a concurrent pause/cancel wins).
        const claimed = await db.analysisJob.updateMany({
          where: { id: next.id, status: "QUEUED" },
          data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() },
        });
        if (claimed.count === 0) continue;

        const row = (await db.analysisJob.findUnique({ where: { id: next.id } }))!;
        publish(
          createEvent({
            type: "JOB_RUNNING",
            jobId: row.publicId,
            jobType: row.type,
            stage: row.stage ?? undefined,
            progress: row.progress,
          }),
        );
        await this.runJob(row, handler);
      }
    } catch (error) {
      logError("jobs: pump failed", { error: describeError(error) });
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Run one claimed job. The DB row stays the source of truth: after the
   * handler returns, the row decides the outcome — still RUNNING means the
   * handler finished normally (→ COMPLETED); PAUSED/CANCELLED were set
   * externally and are left untouched.
   */
  private async runJob(row: AnalysisJobRow, handler: JobHandler): Promise<void> {
    const control = this.buildControl(row.id, row.stage);

    try {
      await handler({
        jobId: row.id,
        publicId: row.publicId,
        repositoryId: row.repositoryId,
        input: parseJobInput(row.input),
        control,
        publish,
      });
    } catch (error) {
      const message = sanitizeError(error);
      logError("jobs: handler failed", {
        jobId: row.publicId,
        jobType: row.type,
        error: describeError(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await db.analysisJob.updateMany({
        where: { id: row.id, status: "RUNNING" },
        data: { status: "FAILED", error: message, completedAt: new Date() },
      });
      publish(
        createEvent({
          type: "JOB_FAILED",
          jobId: row.publicId,
          jobType: row.type,
          stage: row.stage ?? undefined,
          error: message,
        }),
      );
      return;
    }

    const finalRow = await db.analysisJob.findUnique({ where: { id: row.id } });
    if (!finalRow) return;
    if (finalRow.status === "PAUSED" || finalRow.status === "CANCELLED") {
      // External stop observed by the handler — pause/resume/cancel already
      // published their events; nothing to finalize.
      return;
    }
    if (finalRow.status !== "RUNNING") return; // defensive: unknown transition

    await db.analysisJob.update({
      where: { id: row.id },
      data: {
        status: "COMPLETED",
        progress: 1,
        stage: "completed",
        completedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    publish(
      createEvent({
        type: "JOB_COMPLETED",
        jobId: row.publicId,
        jobType: row.type,
        stage: "completed",
        progress: 1,
      }),
    );
  }

  /**
   * JobControl reading/writing the DB row. Progress writes are throttled:
   * ≥1 percent-point move, stage change, checkpoint change, or a ~5 s
   * heartbeat window. Every checkpoint write also upserts the
   * analysis_checkpoints "latest" row. Storage errors here propagate into the
   * handler (→ job FAILED with a sanitized reason) — never silent.
   */
  private buildControl(jobId: string, initialStage: string | null): JobControl {
    let lastStage: string | null = initialStage;
    let lastWrittenPct: number | null = null;
    let lastCheckpointJson: string | null = null;
    let lastWriteAt = 0;

    const readStatus = async (): Promise<string | null> => {
      const row = await db.analysisJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      return row?.status ?? null;
    };

    return {
      checkPause: async () => (await readStatus()) === "PAUSED",
      checkCancel: async () => (await readStatus()) === "CANCELLED",
      progress: async (stage, pct, checkpoint) => {
        const now = Date.now();
        const clamped = Math.min(1, Math.max(0, pct));
        const pctPoints = Math.round(clamped * 100);
        const stageChanged = stage !== lastStage;
        const pctMoved = lastWrittenPct === null || Math.abs(pctPoints - lastWrittenPct) >= PROGRESS_WRITE_DELTA;
        const checkpointJson = checkpoint === undefined ? null : JSON.stringify(checkpoint);
        const checkpointChanged =
          checkpointJson !== null && checkpointJson !== lastCheckpointJson;
        const heartbeatDue = now - lastWriteAt >= HEARTBEAT_INTERVAL_MS;

        if (!stageChanged && !pctMoved && !checkpointChanged && !heartbeatDue) return;

        try {
          await db.analysisJob.update({
            where: { id: jobId },
            data: {
              stage,
              progress: clamped,
              heartbeatAt: new Date(),
              ...(checkpointJson !== null ? { checkpoint: checkpointJson } : {}),
            },
          });
          if (checkpointJson !== null) {
            await db.analysisCheckpoint.upsert({
              where: { jobId_key: { jobId, key: "latest" } },
              create: { jobId, key: "latest", payload: checkpointJson },
              update: { payload: checkpointJson },
            });
          }
        } catch (error) {
          logError("jobs: progress write failed", { error: describeError(error) });
          throw new Error("job progress write failed");
        }

        lastStage = stage;
        lastWrittenPct = pctPoints;
        lastCheckpointJson = checkpointJson;
        lastWriteAt = now;
      },
    };
  }

  /* ---------------------------------------------------------------- */

  private async requireJob(publicId: string): Promise<AnalysisJobRow> {
    const row = await db.analysisJob.findUnique({ where: { publicId } });
    if (!row) {
      throw new ApiError("NOT_FOUND", "No job matches the given id.", 404);
    }
    return row;
  }

  /** Wrap storage failures into an honest envelope error — never silent. */
  private async withStorage<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logError(`jobs: ${op} failed`, { error: describeError(error) });
      throw new ApiError("SERVICE_UNAVAILABLE", "The job queue storage is unavailable.", 503);
    }
  }
}

// One queue per process, surviving dev-server HMR via globalThis.
const globalForQueue = globalThis as unknown as { __cmxJobQueue?: JobQueue };

export function getJobQueue(): JobQueue {
  if (!globalForQueue.__cmxJobQueue) {
    globalForQueue.__cmxJobQueue = new JobQueue();
    // Queue init: recover jobs a previous process left RUNNING. Lazy, once
    // per process (guard lives in recovery.ts); dynamic import keeps the
    // module graph acyclic (recovery imports this module for pump access).
    void import("./recovery")
      .then((m) => m.recoverInterruptedJobs())
      .catch((error) => logError("jobs: recovery bootstrap failed", { error: describeError(error) }));
  }
  return globalForQueue.__cmxJobQueue;
}

/* Module-level convenience API used by the jobs routes. */

export async function enqueueJob(input: {
  type: string;
  repositoryId?: string | null;
  input?: Record<string, unknown> | null;
}): Promise<AnalysisJobRow> {
  return getJobQueue().enqueueJob(input);
}

export async function pauseJob(publicId: string): Promise<AnalysisJobRow> {
  return getJobQueue().pauseJob(publicId);
}

export async function resumeJob(publicId: string): Promise<AnalysisJobRow> {
  return getJobQueue().resumeJob(publicId);
}

export async function cancelJob(publicId: string): Promise<AnalysisJobRow> {
  return getJobQueue().cancelJob(publicId);
}

export async function getJobByPublicId(publicId: string): Promise<AnalysisJobRow> {
  return getJobQueue().getJobByPublicId(publicId);
}

export async function listRecentJobs(limit = 20): Promise<AnalysisJobRow[]> {
  return getJobQueue().listRecentJobs(limit);
}

/** Kick the drain loop (used by recovery after re-queueing interrupted jobs). */
export function pumpJobs(): void {
  getJobQueue().drain();
}
