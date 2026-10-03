import { db } from "@/lib/db";
import { publish } from "@/server/events/bus";
import { createEvent } from "@/server/events/types";
import { logError, logInfo } from "@/server/security/logger";

import { pumpJobs } from "./queue";

/**
 * CodeMind X V2 — interrupted-job recovery (Phase 3, spec §5).
 *
 * A previous process that died mid-run leaves analysis_jobs rows stuck in
 * RUNNING (the in-process pump dies with it; SQLite rows survive). On the
 * first touch of the job system in a new process, those rows are set back to
 * QUEUED — progress, checkpoint and everything else on the row preserved,
 * attempts incremented — and the pump is kicked so the (re-registered)
 * handler resumes from the checkpoint.
 *
 * Guarded by a globalThis flag: runs ONCE per process. Triggered lazily from
 * the jobs route modules on first import AND from job-queue init; whichever
 * fires first wins, the other becomes a no-op.
 *
 * Restart-survival note (honest scope): the dev server cannot be restarted
 * from inside a task, so the equivalent proof here is flipping a terminal
 * row back to RUNNING via a script and watching recovery re-queue it — the
 * exact code path a real restart exercises. See worklog Task 3-c-2.
 */

const RECOVERY_STAGE = "recovered-after-restart";

const globalForRecovery = globalThis as unknown as { __cmxJobsRecovered?: boolean };

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function recoverInterruptedJobs(): Promise<void> {
  if (globalForRecovery.__cmxJobsRecovered) return;
  globalForRecovery.__cmxJobsRecovered = true;

  try {
    const stale = await db.analysisJob.findMany({ where: { status: "RUNNING" } });
    for (const job of stale) {
      await db.analysisJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          attempts: { increment: 1 },
          stage: RECOVERY_STAGE,
          // progress / checkpoint / error / timestamps preserved untouched.
        },
      });
      publish(
        createEvent({
          type: "JOB_QUEUED",
          jobId: job.publicId,
          jobType: job.type,
          stage: RECOVERY_STAGE,
          progress: job.progress,
        }),
      );
    }
    if (stale.length > 0) {
      logInfo("jobs: recovered interrupted jobs", { count: stale.length });
    }
    // Drain: recovered rows whose handler is registered now run; rows whose
    // handler is missing fail honestly in the pump ("handler not registered
    // in this runtime").
    pumpJobs();
  } catch (error) {
    logError("jobs: recovery failed", { error: describeError(error) });
  }
}
