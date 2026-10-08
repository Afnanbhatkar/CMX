/**
 * POST /api/assistant/approvals — deliver a chat approval decision to the
 * orchestrator's approval gate (Phase 9.6).
 *
 * When an Agent-mode chat run reaches the coding agent, the run PAUSES at
 * the engine's approval gate and the chat shows the real approval card.
 * This route records the human decision on the persisted Approval row and
 * releases the gate — the orchestration then continues live in the same
 * chat stream (critic → composed answer).
 *
 * Body: { approvalId: string, decision: "approved" | "rejected", note?: string }.
 * Approval is RECORDED — nothing is applied to disk (the change-set apply
 * step does not exist in this build; RULES.md §6).
 */

import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { db } from "@/lib/db";
import { decideApproval } from "@/server/orchestrator/engine";
import { logInfo, logWarn } from "@/server/security/logger";

const bodySchema = z.object({
  approvalId: z.string().min(1).max(80),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).nullable().optional(),
});

export const POST = withApi(async (req) => {
  const parsed = bodySchema.parse(await req.json());

  // The approval must exist and belong to an orchestrator run (the chat
  // card only surfaces orchestrator approvals with a real run id).
  const approval = await db.approval.findUnique({ where: { id: parsed.approvalId } });
  if (!approval || approval.runId === null) {
    return Response.json(
      { ok: false, error: "Approval request not found." },
      { status: 404 },
    );
  }
  const run = await db.agentRun.findUnique({ where: { id: approval.runId } });
  if (!run || run.kind !== "orchestrator" || run.publicId === null) {
    return Response.json(
      { ok: false, error: "This approval does not belong to an orchestrator run." },
      { status: 409 },
    );
  }

  const result = await decideApproval(
    run.publicId,
    parsed.approvalId,
    parsed.decision,
    parsed.note ?? null,
  );
  if (!result.ok) {
    logWarn("assistant approvals: decision not applied", {
      approvalId: parsed.approvalId,
      reason: result.message,
    });
    return Response.json({ ok: false, error: result.message }, { status: 409 });
  }

  logInfo("assistant approvals: decision recorded", {
    approvalId: parsed.approvalId,
    run: run.publicId,
    decision: parsed.decision,
  });
  return jsonOk(result);
}, { allowBody: true });
