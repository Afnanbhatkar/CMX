import { withApi } from "@/server/api/with-api";
import { jsonError, jsonOk } from "@/server/api/envelope";
import { getAuthContext, listProviders } from "@/server/security/auth";

/**
 * /api/auth — honest auth surface (V2.1 §A/E).
 *
 * GET reports the REAL auth state of this deployment:
 * - configured: false — no provider is enabled (CODEMIND_AUTH_PROVIDER unset);
 * - mode: "unconfigured" — the exact context getAuthContext() returns today;
 * - providers: registered provider ids. "local" is a SESSION-LIFECYCLE SEAM
 *   only (createSession/validateSession/revokeSession exist on the
 *   AuthSession model); it does not authenticate requests by itself;
 * - sessionLifecycle: "ready" — the token-hash session lifecycle is
 *   implemented and ready for the phase that wires credential flows.
 *
 * POST stays an honest 501 NOT_IMPLEMENTED: the contract is prepared, real
 * credential flows arrive in the auth phase. The body is never read and no
 * credentials are ever accepted or echoed (RULES.md §9 — no fake login).
 * NextAuth (v4, present in package.json) is [PLANNED] and intentionally NOT
 * wired to routes yet.
 */
export const GET = withApi(async (req, ctx) => {
  const auth = await getAuthContext(req);
  return jsonOk(
    {
      configured: false,
      mode: auth.mode,
      providers: listProviders(),
      sessionLifecycle: "ready",
      note:
        "No provider is configured, so every route is unauthenticated by design (public/local single-user mode). " +
        "The session lifecycle (create/validate/revoke with SHA-256-hashed tokens) is ready; " +
        "credential flows and NextAuth integration arrive in a later phase. Nothing here fakes a login.",
    },
    { requestId: ctx.requestId },
  );
});

export const POST = withApi(
  async (_req, ctx) =>
    jsonError(
      "NOT_IMPLEMENTED",
      "Auth credential flows arrive in a later phase — contract is prepared. Credentials are not accepted or echoed.",
      { status: 501, requestId: ctx.requestId },
    ),
  { allowBody: true },
);
