import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { recoverInterruptedJobs } from "@/server/jobs/recovery";
import { getJobByPublicId } from "@/server/jobs/queue";
import { serializeJob } from "@/server/jobs/serialize";

/**
 * GET /api/jobs/[id] — one job by its PUBLIC id (AnalysisJob.publicId).
 * Missing ids answer with the NOT_FOUND envelope (404).
 *
 * Next 16 async params: `{ params: Promise<{ id: string }> }` forwarded
 * untouched by withApi. Module-level recovery hook (lazy, once per process).
 */
void recoverInterruptedJobs();

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export const GET = withApi<RouteCtx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const row = await getJobByPublicId(id);
  return jsonOk(serializeJob(row), { requestId: ctx.requestId });
});
