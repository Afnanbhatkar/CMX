import { withApi } from "@/server/api/with-api";
import { jsonError } from "@/server/api/envelope";
import { getAuthContext } from "@/server/security/auth";

/**
 * GET /api/auth — [PLANNED] skeleton (Phase 3, spec §4).
 *
 * Future contract: NextAuth-backed session surface —
 * GET returns the current session/auth context (never a fabricated user);
 * POST /api/auth/signin|signout style actions arrive with the auth phase.
 * Until then the only honest answer is 501 NOT_IMPLEMENTED.
 */
export const GET = withApi(async (_req, ctx) => {
  // Auth context is available but unconfigured — referenced so the seam is
  // visible here; no route may claim auth is active (RULES.md §9).
  getAuthContext(_req);
  return jsonError(
    "NOT_IMPLEMENTED",
    "Auth endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  );
});
