/**
 * POST /api/orchestrator/runs/[id]/cancel — abort a queued/running/
 * waiting-approval orchestrator run (spec §9 acceptance: cancel).
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { cancelRun, getRunState } from "@/server/orchestrator/engine";

type RouteCtx = { params: Promise<{ id: string }> };

export const POST = withApi<RouteCtx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const cancelled = await cancelRun(id);
  const state = await getRunState(id);
  return jsonOk({ cancelled, run: state });
});
