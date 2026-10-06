/**
 * POST /api/orchestrator/runs/[id]/approve — record the human decision on a
 * pending approval request (spec §9 acceptance: approval).
 *
 * Body: { approvalId: string, decision: "approved" | "rejected", note?: string }.
 * Approval is RECORDED — nothing is applied to disk in this phase
 * (the change-set workflow's apply step is a separate explicit action).
 */

import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { decideApproval } from "@/server/orchestrator/engine";

type RouteCtx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  approvalId: z.string().min(1).max(80),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).nullable().optional(),
});

export const POST = withApi<RouteCtx>(
  async (req, ctx) => {
    const { id } = await ctx.params;
    const parsed = bodySchema.parse(await req.json());
    const result = await decideApproval(
      id,
      parsed.approvalId,
      parsed.decision,
      parsed.note ?? null,
    );
    return jsonOk(result, { requestId: ctx.requestId });
  },
  { allowBody: true },
);
