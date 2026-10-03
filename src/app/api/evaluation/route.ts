import { withApi } from "@/server/api/with-api";
import { jsonError } from "@/server/api/envelope";

/**
 * /api/evaluation — [PLANNED] skeleton (Phase 3, spec §4).
 *
 * Future contract:
 * - GET ?run= → evaluation records (Evaluation rows) for agent runs —
 *   real measured outcomes only, per RULES.md §8/§13;
 * - POST → register an evaluation case for an AgentRun.
 */
export const GET = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Evaluation endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);

export const POST = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Evaluation endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);
