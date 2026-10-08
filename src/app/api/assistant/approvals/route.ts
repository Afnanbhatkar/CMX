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
 * Body: { approvalId: string, decision: "approved" | "rejected", note?: string,
 *         excludePaths?: string[] }.
 * `excludePaths` (approval-time per-file opt-out): the user removed file
 * chips on the approval card — those CodeChange rows are marked discarded
 * BEFORE the gate releases, so the apply step never touches them and the
 * persisted approval payload/counts tell the truth.
 * Approval is RECORDED — nothing is applied to disk here (the change-set
 * apply step runs inside the engine after the gate releases; RULES.md §6).
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
  excludePaths: z.array(z.string().min(1).max(400)).max(12).optional(),
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

  // ---- Per-file opt-out (the ✕ on the approval card's file chips) ----
  // Discard the excluded CodeChange rows and refresh the persisted payload
  // BEFORE the gate releases — apply() then applies only what remains.
  if (parsed.decision === "approved" && parsed.excludePaths && parsed.excludePaths.length > 0) {
    const pendingChangeSet = await db.changeSet.findFirst({
      where: { runId: approval.runId, status: "proposed" },
      orderBy: { createdAt: "desc" as const },
    });
    if (pendingChangeSet) {
      const excluded = await db.codeChange.updateMany({
        where: {
          changeSetId: pendingChangeSet.id,
          path: { in: parsed.excludePaths },
          status: "proposed",
        },
        data: { status: "discarded" },
      });
      const remaining = await db.codeChange.findMany({
        where: { changeSetId: pendingChangeSet.id, status: "proposed" },
        orderBy: { createdAt: "asc" as const },
      });
      try {
        const payload = JSON.parse(approval.payload ?? "{}") as {
          whatWillChange?: string;
          affectedFiles?: string[];
          risk?: string;
          changes?: { path: string; changeKind: string; reason: string }[];
          counts?: { created: number; modified: number; deleted: number };
          [key: string]: unknown;
        };
        const remainingOps = remaining.map((c) => ({
          path: c.path,
          changeKind: c.changeKind,
          reason:
            payload.changes?.find((ch) => ch.path === c.path)?.reason ?? "requested change",
        }));
        const counts = {
          created: remainingOps.filter((c) => c.changeKind === "add").length,
          modified: remainingOps.filter((c) => c.changeKind === "modify").length,
          deleted: remainingOps.filter((c) => c.changeKind === "delete").length,
        };
        const removedNote = `(${excluded.count} file(s) you removed will not be changed: ${parsed.excludePaths.join(", ")})`;
        const updated = {
          ...payload,
          whatWillChange: `${pendingChangeSet.title} — ${remaining.length} file change(s): ${remaining.map((c) => c.path).join(", ")} ${removedNote}`.trim(),
          affectedFiles: remaining.map((c) => c.path),
          risk:
            `${counts.created} created · ${counts.modified} modified · ${counts.deleted} deleted — after approval the listed files are actually written and verified.`,
          changes: remainingOps,
          counts,
        };
        await db.approval.update({
          where: { id: approval.id },
          data: { payload: JSON.stringify(updated) },
        });
      } catch (error) {
        // Payload refresh is best-effort — the discarded rows are the truth
        // the apply step trusts; never fail the decision over the note.
        logWarn("assistant approvals: payload refresh failed after exclusion", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      logInfo("assistant approvals: per-file exclusion recorded", {
        approvalId: parsed.approvalId,
        excluded: excluded.count,
        remaining: remaining.length,
      });
    }
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
