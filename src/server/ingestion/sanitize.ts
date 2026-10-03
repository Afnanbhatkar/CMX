/**
 * CodeMind X V2 — credential redaction + URL sanitization (Phase 4, spec §1/§6).
 *
 * The import token may exist ONLY inside the ephemeral clone URL passed to the
 * git process. Every log line, DB row, checkpoint, event, and error message
 * that could carry a URL or a token goes through `redactSecret` here.
 *
 * Redaction patterns (spec §6):
 * - the raw token string itself (exact match),
 * - "://<user>:<token>@" URL credentials,
 * - "x-access-token:<token>" header-style credentials.
 */

/** Redact every secret occurrence from an arbitrary string. */
export function redactSecret(text: string, secrets?: string[]): string {
  let out = text;

  // URL-embedded credentials: "scheme://user:password@host" → "scheme://[redacted]@host".
  out = out.replace(/:\/\/[^/@\s:]+:[^/@\s]+@/g, "://[redacted]@");
  // Header-style credentials used by git for token auth.
  out = out.replace(/x-access-token:[^\s@]+/gi, "x-access-token:[redacted]");
  // Generic bearer-ish fragments in error text (defense in depth).
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]");

  if (secrets) {
    for (const secret of secrets) {
      if (secret && secret.length >= 4 && out.includes(secret)) {
        // Split-join (not regex): tokens may contain regex metacharacters.
        out = out.split(secret).join("[redacted]");
      }
    }
  }
  return out;
}

/**
 * Build a persisted-safe source URL: strips query + fragment (they can carry
 * tokens, e.g. `?token=…` on some hosts) and any embedded userinfo, then
 * redacts defensively. The value stored in Repository.sourceUrl NEVER
 * contains credentials (schema contract, Phase 3-b).
 */
export function sanitizeSourceUrl(rawUrl: string): string {
  let out = rawUrl.trim();
  try {
    const parsed = new URL(out);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    out = parsed.toString();
    // URL.toString() keeps an empty userinfo separator only when credentials
    // existed; the regex pass below is the defensive net either way.
  } catch {
    // Non-URL-shaped input (should never happen post-validation) — fall
    // through to pattern redaction only.
  }
  return redactSecret(out);
}

/** Redact a git stderr/stdout blob before it may enter an error or log. */
export function sanitizeGitOutput(output: string, secrets?: string): string {
  const singleLine = output.replace(/\s+/g, " ").trim().slice(0, 300);
  return redactSecret(singleLine, secrets ? [secrets] : undefined);
}

/** URL-safe slug fragment for repository names/slugs. */
export function slugifyName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "repository";
}
