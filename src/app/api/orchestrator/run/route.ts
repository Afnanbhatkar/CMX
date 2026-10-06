/**
 * POST /api/orchestrator/run — start a Phase 9 orchestrator run.
 *
 * Body: { request: string, preset?: string, fault?: { agent, mode } }.
 * Returns { runPublicId } — poll GET /api/orchestrator/runs/[id] for state.
 * Observability: metadata only (never request content in logs).
 */

import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { AGENT_NAMES, type AgentName } from "@/server/orchestrator/contracts";
import { startRun } from "@/server/orchestrator/engine";

const bodySchema = z.object({
  request: z.string().min(3).max(2000),
  preset: z.string().max(80).nullable().optional(),
  fault: z
    .object({
      agent: z.enum(AGENT_NAMES as unknown as [AgentName, ...AgentName[]]),
      mode: z.enum(["error", "error-once", "timeout"]),
    })
    .nullable()
    .optional(),
});

export const POST = withApi(
  async (req) => {
    const parsed = bodySchema.parse(await req.json());
    const runPublicId = await startRun({
      request: parsed.request,
      preset: parsed.preset ?? null,
      fault: parsed.fault ?? null,
    });
    return jsonOk({ runPublicId });
  },
  { allowBody: true },
);
