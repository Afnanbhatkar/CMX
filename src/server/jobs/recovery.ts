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

/**
 * Staleness cutoff before a RUNNING row counts as orphaned.
 *
 * Next.js dev can serve route modules from more than one worker process;
 * this process' once-per-process guard does not protect across workers, so
 * recovery must NEVER requeue a row another worker may legitimately be
 * executing. The heartbeat is refreshed by control.progress on every stage
 * change / percent move / ~5 s idle window; the longest legitimate silent
 * stretch is one full git invocation (INGESTION command timeout, 10 min), so
 * the cutoff is that plus a 60 s margin. The requeue itself is a CONDITIONAL
 * updateMany (status still RUNNING AND heartbeat older than the cutoff) so
 * two workers racing on the same row cannot both requeue it.
 */
const RECOVERY_STALE_MS = 11 * 60 * 1000;

const globalForRecovery = globalThis as unknown as { __cmxJobsRecovered?: boolean };

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function recoverInterruptedJobs(): Promise<void> {
  if (globalForRecovery.__cmxJobsRecovered) return;
  globalForRecovery.__cmxJobsRecovered = true;

  try {
    const cutoff = new Date(Date.now() - RECOVERY_STALE_MS);
    const stale = await db.analysisJob.findMany({
      where: {
        status: "RUNNING",
        OR: [
          { heartbeatAt: { lt: cutoff } },
          { heartbeatAt: null, startedAt: { lt: cutoff } },
          { heartbeatAt: null, startedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });

    for (const job of stale) {
      // Conditional claim: only requeue when the row is STILL RUNNING and
      // STILL stale (another worker may have finished it in between).
      const requeued = await db.analysisJob.updateMany({
        where: {
          id: job.id,
          status: "RUNNING",
          OR: [
            { heartbeatAt: { lt: cutoff } },
            { heartbeatAt: null, startedAt: { lt: cutoff } },
            { heartbeatAt: null, startedAt: null, createdAt: { lt: cutoff } },
          ],
        },
        data: {
          status: "QUEUED",
          attempts: { increment: 1 },
          stage: RECOVERY_STAGE,
          // progress / checkpoint / error / timestamps preserved untouched.
        },
      });
      if (requeued.count === 0) continue;
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
    logInfo("jobs: recovery check complete", {
      found: stale.length,
      note: "always pumps afterwards — queued rows from a previous process must drain even when nothing was orphaned",
    });
    // Drain: recovered rows whose handler is registered now run; rows whose
    // handler is missing fail honestly in the pump ("handler not registered
    // in this runtime"). QUEUED rows from before a restart also drain here —
    // this is the ONLY post-restart pump trigger, so it must run unconditionally.
    pumpJobs();
  } catch (error) {
    logError("jobs: recovery failed", { error: describeError(error) });
  }
}
