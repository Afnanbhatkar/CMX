import { withApi } from "@/server/api/with-api";
import { jsonError } from "@/server/api/envelope";

/**
 * /api/architecture — [PLANNED] skeleton (Phase 3, spec §4).
 *
 * Future contract:
 * - GET ?repository=&path= → architecture map of the indexed repository
 *   (modules, dependencies, layers) built by the Phase 5+ indexing pipeline;
 * - POST → request a (re)analysis of a repository's architecture.
 * Requires repository indexing (later phase) — honestly NOT_IMPLEMENTED now.
 */
export const GET = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Architecture endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);

export const POST = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Architecture endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);
