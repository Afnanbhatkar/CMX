import { withApi } from "@/server/api/with-api";
import { jsonError } from "@/server/api/envelope";

/**
 * /api/testing — [PLANNED] skeleton (Phase 3, spec §4).
 *
 * Future contract:
 * - GET ?repository= → generated tests (GeneratedTest rows) + run status;
 * - POST → request test generation / execution for a target (sandboxed runs
 *   with human approval gates per RULES.md §6).
 */
export const GET = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Testing endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);

export const POST = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Testing endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);
