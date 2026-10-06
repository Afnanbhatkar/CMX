/**
 * /api/memory/drift — Phase 9.5 memory-vs-code drift (spec §7).
 *   GET  — run the heuristic drift check over ACTIVE memories vs the real
 *          workspace files. Verdicts: ok | possible-drift | contradiction.
 *   POST — { id, decision: "reviewed" | "kept" } — records the user's
 *          drift decision (append-only). Update/Disable go through the
 *          item PATCH endpoint.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { z } from "zod";

import { checkMemoryDrift, recordDriftDecision } from "@/server/memory/engine";

export const dynamic = "force-dynamic";

const decideSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["reviewed", "kept"]),
});

export const GET = withApi(async () => {
  const result = await checkMemoryDrift();
  return jsonOk(result);
});

export const POST = withApi(async (req) => {
  const body = decideSchema.parse(await req.json());
  const result = await recordDriftDecision(body.id, body.decision);
  return jsonOk(result);
});
