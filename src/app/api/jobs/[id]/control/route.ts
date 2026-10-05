import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { recoverInterruptedJobs } from "@/server/jobs/recovery";
import { cancelJob, pauseJob, resumeJob } from "@/server/jobs/queue";
import { serializeJob } from "@/server/jobs/serialize";

/**
 * POST /api/jobs/[id]/control — pause / resume / cancel a job (Phase 3, spec §5).
 *
 * - pause:   QUEUED|RUNNING → PAUSED (a running handler observes it at its
 *            next cooperative control check);
 * - resume:  PAUSED → QUEUED (progress/checkpoint preserved), pump re-claims;
 * - cancel:  QUEUED|RUNNING|PAUSED → CANCELLED (terminal).
 *
 * Invalid transitions answer 409 CONFLICT with the actual state in the
 * message; unknown ids answer 404 NOT_FOUND. Module-level recovery hook
 * (lazy, once per process).
 */
void recoverInterruptedJobs();

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const controlSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

export const POST = withApi<RouteCtx>(
  async (req, ctx) => {
    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const { action } = controlSchema.parse(body);
    const row =
      action === "pause"
        ? await pauseJob(id)
        : action === "resume"
          ? await resumeJob(id)
          : await cancelJob(id);

    return jsonOk(serializeJob(row), { requestId: ctx.requestId });
  },
  { allowBody: true },
);
