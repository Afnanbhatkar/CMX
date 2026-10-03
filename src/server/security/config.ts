/**
 * CodeMind X V2 — security configuration + API response headers (Phase 3, §8).
 *
 * Single source of truth for the security posture that IS implemented now,
 * with honest markers for what is [PLANNED].
 */

export const SECURITY_CONFIG = {
  /** Hard cap for request bodies enforced by withApi (POST/PUT/PATCH). */
  maxBodyBytes: 1_000_000,
  cors: {
    strategy: "same-origin",
    allowOrigins: [] as string[],
    note: "No wildcard CORS. Cross-origin API access is [PLANNED] with an explicit allowlist.",
  },
  rateLimit: {
    enabled: false,
    note: "[PLANNED]",
  },
} as const;

/**
 * Headers attached to every API response by withApi.
 * - nosniff: browsers must not MIME-sniff API responses;
 * - strict referrer policy: no path/query leakage to other origins;
 * - no-store: API answers (health, repository data) are never cached.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store",
  };
}
