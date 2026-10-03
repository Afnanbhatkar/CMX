import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { db } from "@/lib/db";
import { recoverInterruptedJobs } from "@/server/jobs/recovery";
import { enqueueJob, listRecentJobs } from "@/server/jobs/queue";
import { serializeJob } from "@/server/jobs/serialize";

/**
 * POST /api/jobs — enqueue a registered job type (Phase 3, spec §5).
 * GET  /api/jobs — the 20 most recent jobs, newest first.
 *
 * The queue is in-process; state persists in SQLite (analysis_jobs rows are
 * the source of truth). Redis-backed workers are [PLANNED] — stated in the
 * GET response, never implied.
 *
 * Restart recovery: the module-level call below is the lazy, once-per-process
 * hook (guarded in recovery.ts) that re-queues jobs a previous process left
 * RUNNING before this route serves its first request.
 */
void recoverInterruptedJobs();

export const dynamic = "force-dynamic";

const enqueueSchema = z.object({
  type: z.string().min(1).max(100),
  repositoryId: z.string().min(1).max(64).optional(),
});

export const POST = withApi(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = enqueueSchema.parse(body);

    if (parsed.repositoryId) {
      const repository = await db.repository.findUnique({
        where: { id: parsed.repositoryId },
        select: { id: true },
      });
      if (!repository) {
        throw new ApiError("NOT_FOUND", "No repository matches the given id.", 404);
      }
    }

    const row = await enqueueJob({ type: parsed.type, repositoryId: parsed.repositoryId ?? null });
    return jsonOk(serializeJob(row), { status: 202, requestId: ctx.requestId });
  },
  { allowBody: true },
);

export const GET = withApi(async (_req, ctx) => {
  const rows = await listRecentJobs(20);
  return jsonOk(
    {
      jobs: rows.map(serializeJob),
      note: "in-process queue; state persists in SQLite; Redis-backed workers are [PLANNED]",
    },
    { requestId: ctx.requestId },
  );
});
