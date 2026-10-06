/**
 * GET /api/orchestrator/runs/[id] — poll one orchestrator run's full state
 * (trace spans, plan, answer, critic verdict, approvals, change-sets).
 */

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { getRunState } from "@/server/orchestrator/engine";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export const GET = withApi<RouteCtx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const state = await getRunState(id);
  if (!state) {
    throw new ApiError("NOT_FOUND", "orchestrator run not found", 404);
  }
  return jsonOk(state, { requestId: ctx.requestId });
});
