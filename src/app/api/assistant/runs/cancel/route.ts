import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { logInfo } from "@/server/security/logger";
import { cancelPendingRun, hasPendingAnswers } from "@/server/services/run-answers-registry";
import { getOrchestratorMapping } from "@/server/services/run-stream-registry";
import { cancelRun } from "@/server/orchestrator/engine";

/**
 * POST /api/assistant/runs/cancel — Agent Mode V2: cancel a PAUSED run.
 *
 * While a run is paused (approval gate / intake questions) the phase-1 SSE
 * response is gone, so the client's Stop button can no longer abort the
 * fetch to cancel the run. This route reaches the run through the registry:
 * the orchestrator gate is aborted and any pending intake wait is cancelled.
 * The abort surfaces as an honest RUN_CANCELLED frame in the run's ledger
 * (the phase-1 route's error path), so a later resume replays the truth.
 */

const bodySchema = z.object({
  runId: z.string().min(8).max(120),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }

  const { runId } = parsed.data;
  const orchestratorRunId = getOrchestratorMapping(runId);

  let orchestratorCancelled = false;
  if (orchestratorRunId) {
    orchestratorCancelled = await cancelRun(orchestratorRunId).catch(() => false);
  }

  const hadIntakeWait = hasPendingAnswers(runId);
  cancelPendingRun(runId);

  logInfo("assistant run cancelled (paused run cancel route)", {
    runId,
    orchestratorRunId,
    hadIntakeWait,
  });

  return Response.json(
    { ok: true, orchestratorCancelled },
    { headers: securityHeaders() },
  );
}
