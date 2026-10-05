import { withApi } from "@/server/api/with-api";
import { jsonError } from "@/server/api/envelope";

/**
 * /api/security — [PLANNED] skeleton (Phase 3, spec §4).
 *
 * Future contract:
 * - GET ?repository= → security findings list (SecurityFinding rows produced
 *   by the future scanning engine; nothing is scanned or scored today);
 * - POST ?action=scan → start a scan job through the job system.
 * The security layer that IS real now (envelope, body limits, security
 * headers, trust boundaries) lives in src/server/security + withApi.
 */
export const GET = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Security endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);

export const POST = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Security endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);
