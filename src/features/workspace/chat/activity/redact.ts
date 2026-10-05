"use client";

/**
 * CodeMind X V2 — activity-chain secret redaction (Phase 8D).
 *
 * Reusable redaction applied INSIDE the activity adapter BEFORE any text can
 * reach the UI (the spec requires redaction before render, never visual
 * masking alone). Every pattern replaces the whole matched value with
 * "[redacted]" while keeping the surrounding key/label readable.
 *
 * Rules (master prompt §61):
 * - API keys, access/bearer tokens, Authorization values
 * - password=, --token, credential-bearing URLs
 * - .env* assignments and secret-ish environment values
 * - control characters stripped, field lengths capped
 */

/** Hard cap for any rendered activity string (chars). */
export const ACTIVITY_FIELD_CAP = 200;

/** Secret-ish assignment keys (KEY=VALUE / KEY: VALUE / --key VALUE). */
const SECRET_KEY_PATTERN =
  /(api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|secret|password|passwd|pwd|credential[s]?|authorization|session[-_]?id|private[-_]?key|client[-_]?secret)/gi;

/** Well-known token shapes (JWT, OpenAI-style, GitHub, Slack). */
const TOKEN_SHAPE_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /\bsk-[A-Za-z0-9_-]{16,}/g, // sk-… API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
];

/** Authorization / Bearer header values. */
const BEARER_PATTERN = /(bearer\s+)[^\s'",;)]+/gi;
const AUTH_HEADER_PATTERN = /(authorization["']?\s*[:=]\s*["']?)[^\s'",}]+/gi;

/** Credential URLs: scheme://user:pass@host */
const CRED_URL_PATTERN = /(\w+:\/\/)[^\s/@]+:[^\s/@]+@/g;

/** KEY=VALUE / KEY: VALUE where KEY is secret-ish (value up to delimiter). */
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `([\\w.\\-]*(?:${SECRET_KEY_PATTERN.source})[\\w.\\-]*\\s*[:=]\\s*)(["']?)[^\\s"'}],]+\\2`,
  "gi",
);

/** --token VALUE / --password VALUE style CLI flags. */
const CLI_FLAG_PATTERN =
  /(--(?:api-?key|token|access-?token|password|secret|auth)(?:[= ]))(?:"[^"]*"|'[^']*'|[^\s]+)/gi;

/** .env file references with a value: `.env (FOO=bar)` → `.env ([redacted])`. */
const ENV_FILE_PATTERN = /(\.env\w*\s*(?:\(|:)?\s*)([A-Za-z0-9_]+=[^\s)"]+)/gi;

/** Control characters (except tab/newline, which are normalized later). */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Redact one activity string in place (safe to call on any text). */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;

  for (const pattern of TOKEN_SHAPE_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  out = out.replace(BEARER_PATTERN, "$1[redacted]");
  out = out.replace(AUTH_HEADER_PATTERN, "$1[redacted]");
  out = out.replace(CRED_URL_PATTERN, "$1[redacted]@");
  out = out.replace(CLI_FLAG_PATTERN, "$1[redacted]");
  out = out.replace(ENV_FILE_PATTERN, "$1[redacted]");
  out = out.replace(SECRET_ASSIGNMENT_PATTERN, "$1$2[redacted]$2");

  // Strip control characters, then cap the length.
  out = out.replace(CONTROL_CHARS, "");
  if (out.length > ACTIVITY_FIELD_CAP) {
    out = `${out.slice(0, ACTIVITY_FIELD_CAP)}…`;
  }
  return out;
}

/** Redact + collapse whitespace for single-line detail strings. */
export function redactDetail(input: string): string {
  const redacted = redactSecrets(input);
  return redacted.replace(/\s+/g, " ").trim();
}
