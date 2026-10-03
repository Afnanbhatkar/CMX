import { withApi } from "@/server/api/with-api";
import { jsonError } from "@/server/api/envelope";

/**
 * /api/impact — [PLANNED] skeleton (Phase 3, spec §4).
 *
 * Future contract:
 * - POST { repository, change: { path, kind } } → impact analysis of a
 *   proposed change over the code graph (symbols, callers, dependents) built
 *   by the indexing/graph phases. Requires the repository graph — no fake
 *   impact scores before that exists.
 */
export const GET = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Impact endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);

export const POST = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Impact endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);
