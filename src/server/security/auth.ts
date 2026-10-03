/**
 * CodeMind X V2 — authentication & authorization foundation (V2.1 §A).
 *
 * HONESTY RULES (RULES.md §9 — no fake functionality):
 * - By default NO provider is configured, so `getAuthContext()` keeps
 *   returning the honest `{ authenticated: false, mode: "unconfigured" }` it
 *   has returned since Phase 3. No route may claim authentication is active.
 * - Nothing requires auth today: every existing route stays in public/local
 *   single-user mode. This module only makes the machinery READY — real
 *   credential flows arrive in a later phase (POST /api/auth is an honest 501).
 * - NextAuth is [PLANNED]: next-auth v4 is present in package.json, but NO
 *   NextAuth routes/handlers are wired — document, don't pretend.
 * - Raw session tokens are NEVER logged and NEVER persisted; only the
 *   SHA-256 hex hash of a token is stored (auth_sessions.token_hash).
 *
 * The "local" provider is registered ONLY as a seam so the session lifecycle
 * below is exercisable end-to-end; it is NOT enabled for request auth unless
 * CODEMIND_AUTH_PROVIDER is explicitly set ([PLANNED]).
 */

import { db } from "@/lib/db";
import { ApiError } from "@/server/api/envelope";
import { audit } from "@/server/security/audit";

// ---------------------------------------------------------------------------
// AuthProvider abstraction + registry
// ---------------------------------------------------------------------------

/** Provider-stable identity of an authenticated principal. */
export interface AuthIdentity {
  subject: string;
  provider: string;
  displayName?: string;
}

/** Pluggable auth backend. `verifySession` must never throw — return null. */
export interface AuthProvider {
  id: string;
  verifySession(token: string): Promise<AuthIdentity | null>;
}

const providers = new Map<string, AuthProvider>();

/** Register an auth provider (idempotent per id — last registration wins). */
export function registerProvider(provider: AuthProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): AuthProvider | undefined {
  return providers.get(id);
}

/** Registered provider ids (e.g. the "local" seam). */
export function listProviders(): string[] {
  return [...providers.keys()];
}

// ---------------------------------------------------------------------------
// Auth contexts
// ---------------------------------------------------------------------------

export interface UnauthenticatedContext {
  /** Always false until the auth phase is implemented — no faking. */
  authenticated: false;
  /** "unconfigured": no provider set up. "unauthenticated": provider set up, no/invalid credentials. */
  mode: "unconfigured" | "unauthenticated";
  note: string;
}

export interface AuthenticatedContext {
  authenticated: true;
  mode: "authenticated";
  identity: AuthIdentity;
}

export type AuthContext = UnauthenticatedContext | AuthenticatedContext;

const UNCONFIGURED_CONTEXT: UnauthenticatedContext = {
  authenticated: false,
  mode: "unconfigured",
  note: "Authentication is not configured yet. NextAuth integration is [PLANNED]; all API access is currently unauthenticated by design.",
};

/**
 * The provider that request authentication would use. Deliberately unset in
 * every current deployment — [PLANNED] for the auth phase.
 */
function configuredProviderId(): string | null {
  const raw = process.env.CODEMIND_AUTH_PROVIDER?.trim();
  return raw ? raw : null;
}

/** Extract a presented session token (never logged). */
function extractPresentedToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1];
  }
  const sessionHeader = req.headers.get("x-session-token");
  return sessionHeader && sessionHeader.trim().length > 0 ? sessionHeader.trim() : null;
}

/**
 * Resolve the auth context for a request. Reads a presented token ONLY when a
 * provider is explicitly configured; otherwise returns the honest
 * unconfigured context. Signature stays stable for the [PLANNED] auth phase.
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const providerId = configuredProviderId();
  if (!providerId) return UNCONFIGURED_CONTEXT;
  const provider = getProvider(providerId);
  if (!provider) {
    // Configured id has no registered implementation — stay honest, don't guess.
    return UNCONFIGURED_CONTEXT;
  }
  const token = extractPresentedToken(req);
  if (!token) {
    return {
      authenticated: false,
      mode: "unauthenticated",
      note: "Authentication is required: present a valid session token.",
    };
  }
  const identity = await provider.verifySession(token);
  if (!identity) {
    return {
      authenticated: false,
      mode: "unauthenticated",
      note: "The presented session token is invalid or expired.",
    };
  }
  return { authenticated: true, mode: "authenticated", identity };
}

/**
 * Guard for future protected routes: throws a 401 envelope error when the
 * context is not authenticated. Usage (INSIDE a withApi handler so the error
 * maps to the envelope):
 *   const auth = requireAuth(await getAuthContext(req));
 */
export function requireAuth(ctx: AuthContext): AuthenticatedContext {
  if (!ctx.authenticated) {
    throw new ApiError(
      "UNAUTHORIZED",
      ctx.mode === "unconfigured"
        ? "Authentication is not configured on this deployment yet."
        : "Authentication required.",
      401,
    );
  }
  return ctx;
}

/**
 * with-auth wrapper for future protected routes. Use INSIDE withApi so thrown
 * ApiErrors map to the consistent 401 envelope:
 *   export const GET = withApi(withAuth(async (req, ctx) => { ctx.auth... }));
 * The wrapper resolves the auth context, rejects unauthenticated requests,
 * and passes the narrowed context to the handler.
 */
export function withAuth<C>(
  handler: (req: Request, ctx: C & { auth: AuthenticatedContext }) => Promise<Response> | Response,
): (req: Request, ctx: C) => Promise<Response> | Response {
  return async (req: Request, ctx: C) => {
    const auth = await getAuthContext(req);
    const narrowed = requireAuth(auth);
    return handler(req, { ...(ctx as C), auth: narrowed });
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle (AuthSession model) — raw tokens never logged/persisted
// ---------------------------------------------------------------------------

const SESSION_TTL_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Configurable session TTL (CODEMIND_AUTH_SESSION_TTL_MS, ms). */
function sessionTtlMs(): number {
  const raw = process.env.CODEMIND_AUTH_SESSION_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SESSION_TTL_DEFAULT_MS;
}

/** Random 32-byte session token, hex-encoded (returned to the caller ONCE). */
function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex digest — the ONLY form of a token that ever touches the DB. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CreatedSession {
  /** Raw token — returned exactly once; store nothing but its hash. */
  token: string;
  publicId: string;
  provider: string;
  subject: string;
  expiresAt: Date;
}

/**
 * Create a session: generate a random 32-byte token, persist ONLY its
 * SHA-256 hash, honor the configured TTL. Records the real "login" audit
 * event (V2.1 §D login seam). Raw token is never logged.
 */
export async function createSession(
  providerId: string,
  subject: string,
  opts?: { userId?: string; ttlMs?: number },
): Promise<CreatedSession> {
  if (!getProvider(providerId)) {
    throw new Error(`Unknown auth provider: ${providerId}`);
  }
  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + (opts?.ttlMs ?? sessionTtlMs()));
  const row = await db.authSession.create({
    data: {
      tokenHash,
      provider: providerId,
      subject,
      userId: opts?.userId ?? null,
      status: "active",
      expiresAt,
    },
  });
  // Login seam: a real session was created (fire-and-forget; audit never throws).
  await audit.login({
    actorId: subject,
    targetType: "session",
    targetId: row.publicId,
    metadata: { provider: providerId },
  });
  return { token, publicId: row.publicId, provider: providerId, subject, expiresAt };
}

export interface ValidatedSession {
  identity: AuthIdentity;
  /** Public session id (safe to log/correlate). */
  publicId: string;
  expiresAt: Date;
}

/**
 * Validate a raw session token by hash lookup: must exist, be active, and be
 * unexpired. Lazily expires stale rows. Updates lastSeenAt on success.
 * Records the "login" audit event on a session's FIRST successful validation
 * (lastSeenAt previously unset) — per-request re-validations are usage, not
 * logins, and would flood the append-only trail. Never logs the raw token.
 */
export async function validateSession(token: string): Promise<ValidatedSession | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db.authSession.findUnique({ where: { tokenHash } });
  if (!row || row.status === "revoked") return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    if (row.status === "active") {
      await db.authSession
        .update({ where: { id: row.id }, data: { status: "expired" } })
        .catch(() => undefined);
    }
    return null;
  }

  const firstUse = row.lastSeenAt === null;
  await db.authSession
    .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  if (firstUse) {
    await audit.login({
      actorId: row.subject,
      targetType: "session",
      targetId: row.publicId,
      metadata: { provider: row.provider },
    });
  }
  return {
    identity: { subject: row.subject, provider: row.provider },
    publicId: row.publicId,
    expiresAt: row.expiresAt,
  };
}

/** Revoke a session by its raw token (hash lookup). Returns true when revoked. */
export async function revokeSession(token: string): Promise<boolean> {
  const tokenHash = await sha256Hex(token);
  const row = await db.authSession.findUnique({ where: { tokenHash } });
  if (!row || row.status === "revoked") return false;
  await db.authSession.update({
    where: { id: row.id },
    data: { status: "revoked" },
  });
  return true;
}

/** Revoke by public session id (admin/recovery path). */
export async function revokeSessionByPublicId(publicId: string): Promise<boolean> {
  const row = await db.authSession.findUnique({ where: { publicId } });
  if (!row || row.status === "revoked") return false;
  await db.authSession.update({
    where: { id: row.id },
    data: { status: "revoked" },
  });
  return true;
}

// ---------------------------------------------------------------------------
// "local" provider — registered as a SEAM ONLY (not configured by default)
// ---------------------------------------------------------------------------

const localAuthProvider: AuthProvider = {
  id: "local",
  async verifySession(token: string): Promise<AuthIdentity | null> {
    try {
      const session = await validateSession(token);
      return session ? session.identity : null;
    } catch {
      return null;
    }
  },
};

registerProvider(localAuthProvider);

// ---------------------------------------------------------------------------
// Repository-level authorization (RepositoryMember)
// ---------------------------------------------------------------------------

export const REPOSITORY_ROLES = ["reader", "writer", "maintainer", "owner"] as const;
export type RepositoryRole = (typeof REPOSITORY_ROLES)[number];

const ROLE_RANK: Record<RepositoryRole, number> = {
  reader: 0,
  writer: 1,
  maintainer: 2,
  owner: 3,
};

/**
 * Repository-level authorization via RepositoryMember. Throws 403 when the
 * subject is not a member or holds a role below `minRole` (order:
 * reader < writer < maintainer < owner). Frontend checks are never trusted —
 * this backend check is the source of truth.
 */
export async function requireRole(
  subject: string,
  repositoryId: string,
  minRole: RepositoryRole,
) {
  const member = await db.repositoryMember.findUnique({
    where: { repositoryId_subject: { repositoryId, subject } },
  });
  if (!member) {
    throw new ApiError("FORBIDDEN", "You do not have access to this repository.", 403);
  }
  const heldRank = ROLE_RANK[member.role as RepositoryRole] ?? -1;
  if (heldRank < ROLE_RANK[minRole]) {
    throw new ApiError(
      "FORBIDDEN",
      `This action requires the '${minRole}' role.`,
      403,
    );
  }
  return member;
}

/** Any membership role grants access (read-level check). */
export async function canAccessRepository(subject: string, repositoryId: string): Promise<boolean> {
  try {
    const count = await db.repositoryMember.count({ where: { subject, repositoryId } });
    return count > 0;
  } catch {
    return false;
  }
}
