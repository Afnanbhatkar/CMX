/**
 * CodeMind X V2 — auth-ready seam (Phase 3, spec §8).
 *
 * This is an HONEST placeholder, not a working auth system. NextAuth is
 * [PLANNED] for a later phase. Until that lands:
 * - no route may claim authentication is active,
 * - nothing here fabricates a user, a session, or a role,
 * - callers get a constant "unconfigured" context they can branch on.
 */

export interface AuthContext {
  /** Always false until the NextAuth phase is implemented — no faking. */
  authenticated: false;
  mode: "unconfigured";
  note: string;
}

/**
 * Resolve the auth context for a request. The `req` parameter is intentionally
 * unused for now (prefixed `_req`): the NextAuth [PLANNED] implementation will
 * read the session from it. Signature is kept stable so routes do not change
 * when real auth arrives.
 */
export function getAuthContext(_req: Request): AuthContext {
  return {
    authenticated: false,
    mode: "unconfigured",
    note: "Authentication is not configured yet. NextAuth integration is [PLANNED]; all API access is currently unauthenticated by design.",
  };
}
