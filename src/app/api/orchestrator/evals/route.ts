/**
 * /api/orchestrator/evals — Phase 9.5 agent evaluation harness (V2.1 §C/§F).
 *   GET  — the last eval report (null when none has run yet).
 *   POST — run the full suite (or one case via { case: "<caseId>" }) against
 *          REAL tools + the REAL gateway; persists an Evaluation row.
 *          Gateway cases fail honestly when the gateway is unavailable.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { z } from "zod";

import {
  getLastEvalReport,
  runEvalSuite,
} from "@/server/orchestrator/evals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const runSchema = z.object({
  case: z.string().max(60).optional(),
});

export const GET = withApi(async () => {
  return jsonOk({ report: getLastEvalReport() });
});

export const POST = withApi(async (req) => {
  const body = runSchema.parse(await req.json().catch(() => ({})));
  const report = await runEvalSuite(body.case);
  return jsonOk({ report });
});
