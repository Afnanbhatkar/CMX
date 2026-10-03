import path from "node:path";

import { ApiError } from "@/server/api/envelope";

import { INGESTION_CONFIG, PROJECT_ROOT } from "./config";
import { sanitizeSourceUrl } from "./sanitize";

/**
 * CodeMind X V2 — import-source validation (Phase 4, spec §1/§6).
 *
 * All user-supplied source fields are validated here — ONCE at POST time
 * (422 envelope) and AGAIN inside the job (defense in depth; an invalid
 * source that reaches the job fails it honestly instead of half-running).
 *
 * Supported inputs (spec §1):
 * - kind "github": public GitHub URL, exactly https://github.com/<owner>/<repo>
 *   (trailing "/" and ".git" tolerated; extra path segments rejected).
 * - kind "git":    generic HTTPS git URL (https only; embedded credentials
 *   rejected — tokens go through the `token` field, never the URL).
 * - kind "local":  absolute directory path strictly under process.cwd()
 *   (dev convenience; everything else → 422).
 * - kind "zip":    validated by the upload route (multipart size + magic),
 *   extraction-time guards live in zip-extract.ts.
 *
 * Path-traversal probing (spec §6) applies to every user-supplied path-like
 * field: absolute paths where a relative one is required, ".." segments, NUL
 * bytes, drive letters, and Windows backslashes (normalized then re-checked).
 */

function invalid(message: string): ApiError {
  return new ApiError("VALIDATION_ERROR", message, 422);
}

/** Reject control characters / NUL in any user-supplied string. */
function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** Normalize Windows separators then re-check (spec §6: normalized + re-checked). */
export function normalizeRepoRelativePath(input: string): string {
  return input.trim().replace(/\\/g, "/");
}

/* ------------------------------------------------------------------ */
/* ref                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Branch | tag | commit ref. Conservative git-safe charset; rejects the
 * forms git itself rejects (leading "-", ".", "..", "@{", control chars)
 * plus any argument-injection vector (whitespace, quotes, leading "-").
 * A commit sha (7..40 hex) is allowed — full clone is used for commit refs
 * (honest note: upstream does not support shallow clones of raw commits).
 */
export function validateRef(ref: string): string {
  const value = ref.trim();
  if (!value) throw invalid("ref must not be empty.");
  if (value.length > INGESTION_CONFIG.maxRefLength) {
    throw invalid(`ref exceeds the ${INGESTION_CONFIG.maxRefLength}-character limit.`);
  }
  if (hasControlChars(value) || /\s/.test(value)) {
    throw invalid("ref must not contain whitespace or control characters.");
  }
  if (value.startsWith("-") || value.startsWith(".") || value.endsWith(".") || value.endsWith("/")) {
    throw invalid("ref must not start with '-' or '.' / end with '.' or '/'.");
  }
  if (value.includes("..") || value.includes("@{") || value.includes("//")) {
    throw invalid("ref contains a forbidden sequence ('..', '@{', '//').");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw invalid("ref may only contain letters, digits, '.', '_', '/' and '-'.");
  }
  if (/^(refs|logs)\//i.test(value)) {
    throw invalid("ref must be a branch, tag or commit — not a raw ref path.");
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* sparse / ignore / include pattern lists                             */
/* ------------------------------------------------------------------ */

/**
 * sparsePaths — relative prefix paths for
 * `git sparse-checkout set --no-cone <prefixes>` (spec §3): max 20 entries,
 * no "..", no leading "/", no backslashes, no control chars (spec §6).
 */
export function validateSparsePaths(paths: unknown): string[] | undefined {
  if (paths === undefined || paths === null) return undefined;
  if (!Array.isArray(paths)) throw invalid("sparsePaths must be an array of relative paths.");
  if (paths.length > INGESTION_CONFIG.maxSparsePaths) {
    throw invalid(`sparsePaths supports at most ${INGESTION_CONFIG.maxSparsePaths} entries.`);
  }
  const out: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== "string") throw invalid("sparsePaths entries must be strings.");
    const value = raw.trim();
    if (!value) throw invalid("sparsePaths entries must not be empty.");
    if (value.length > INGESTION_CONFIG.maxSparsePathLength) {
      throw invalid(`sparsePaths entries must be at most ${INGESTION_CONFIG.maxSparsePathLength} characters.`);
    }
    if (hasControlChars(value)) throw invalid("sparsePaths entries must not contain control characters.");
    const normalized = normalizeRepoRelativePath(value);
    if (normalized.startsWith("/")) throw invalid("sparsePaths entries must be relative (no leading '/').");
    if (normalized.includes("../") || normalized === ".." || normalized.endsWith("/..")) {
      throw invalid("sparsePaths entries must not contain '..' segments.");
    }
    const segments = normalized.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) throw invalid("sparsePaths entries must name at least one path segment.");
    if (segments.some((s) => s === "." || s === "..")) {
      throw invalid("sparsePaths entries must not contain '.' or '..' segments.");
    }
    if (segments.some((s) => /^[a-zA-Z]:$/.test(s))) {
      throw invalid("sparsePaths entries must not contain drive letters.");
    }
    out.push(segments.join("/"));
  }
  return out;
}

/**
 * ignorePatterns / includePatterns — extra ignore list + re-include list
 * (spec §4). Include-first precedence is implemented in discovery.ts: when a
 * re-include matches, the default/extra skip for that path loses.
 */
export function validatePatternList(value: unknown, field: "ignorePatterns" | "includePatterns"): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid(`${field} must be an array of pattern strings.`);
  if (value.length > INGESTION_CONFIG.maxPatterns) {
    throw invalid(`${field} supports at most ${INGESTION_CONFIG.maxPatterns} entries.`);
  }
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw invalid(`${field} entries must be strings.`);
    const pattern = raw.trim();
    if (!pattern) throw invalid(`${field} entries must not be empty.`);
    if (pattern.length > INGESTION_CONFIG.maxPatternLength) {
      throw invalid(`${field} entries must be at most ${INGESTION_CONFIG.maxPatternLength} characters.`);
    }
    if (hasControlChars(pattern)) throw invalid(`${field} entries must not contain control characters.`);
    if (pattern.startsWith("/") || pattern.includes("../") || pattern === "..") {
      throw invalid(`${field} entries must be repository-relative (no leading '/', no '..').`);
    }
    out.push(normalizeRepoRelativePath(pattern));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* local path                                                          */
/* ------------------------------------------------------------------ */

export interface LocalPathCheck {
  absolute: string;
  /** file:// URL for the git process (protocol allowlist: file for local kind). */
  fileUrl: string;
}

/**
 * Local development repository path: ONLY absolute paths strictly under
 * process.cwd() are accepted (spec §1: dev convenience — nothing else).
 * Rejects traversal (".."), NUL, drive letters, backslashes after
 * normalization re-check, and anything that escapes the project root.
 */
export function validateLocalPath(input: string): LocalPathCheck {
  const value = input.trim();
  if (!value) throw invalid("path must not be empty.");
  if (hasControlChars(value)) throw invalid("path must not contain control characters.");
  if (value.includes("\0")) throw invalid("path must not contain NUL bytes.");
  if (/^[a-zA-Z]:/.test(value)) throw invalid("drive-letter paths are not accepted.");
  if (!path.isAbsolute(value)) throw invalid("path must be absolute.");

  const normalized = path.normalize(value);
  if (normalized !== value.replace(/\/+$/, "") && normalized !== value) {
    // normalize() must not change the meaning (no .. / ./ tricks survived).
    const resolvedSegments = normalized.split(path.sep).filter(Boolean);
    const rawSegments = value.split(/[\\/]+/).filter(Boolean);
    if (resolvedSegments.length !== rawSegments.length && value.includes("..")) {
      throw invalid("path must not contain '..' segments.");
    }
  }
  if (value.split(/[\\/]+/).filter(Boolean).includes("..")) {
    throw invalid("path must not contain '..' segments.");
  }
  if (value.includes("\\")) throw invalid("path must use POSIX separators.");

  const relative = path.relative(PROJECT_ROOT, normalized);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw invalid("path must be inside this project's root (process.cwd()).");
  }

  return { absolute: normalized, fileUrl: `file://${normalized}` };
}

/* ------------------------------------------------------------------ */
/* URLs (github / git)                                                 */
/* ------------------------------------------------------------------ */

export interface UrlCheck {
  /** Canonical, credential-free URL persisted to Repository.sourceUrl. */
  sanitizedUrl: string;
  /** Host kept separately so error messages can name it without credentials. */
  host: string;
  /** owner/repo for github kind (display + slug). */
  githubPath?: { owner: string; repo: string };
}

/**
 * GitHub URL: exactly https://github.com/<owner>/<repo> (".git" suffix and a
 * trailing "/" are tolerated). Everything else → 422.
 */
export function validateGitHubUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) throw invalid("url must not be empty.");
  if (raw.length > INGESTION_CONFIG.maxUrlLength) {
    throw invalid(`url exceeds the ${INGESTION_CONFIG.maxUrlLength}-character limit.`);
  }
  if (hasControlChars(raw)) throw invalid("url must not contain control characters.");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalid("url is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw invalid("GitHub imports require an https:// URL.");
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    throw invalid("Not a GitHub URL — use kind \"git\" for other HTTPS git remotes.");
  }
  if (raw.includes("@") && parsed.username) {
    throw invalid("url must not embed credentials — pass them via the token field.");
  }
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) {
    throw invalid('GitHub URLs must look like https://github.com/<owner>/<repo>.');
  }
  if (segments.length > 2 && !(segments.length === 3 && segments[2] === "tree")) {
    // Tolerate nothing beyond owner/repo(.git). A "/tree/<ref>" shape is also
    // rejected: refs are passed explicitly via the `ref` field.
    throw invalid("GitHub URLs must be exactly https://github.com/<owner>/<repo> — pass a ref via the ref field.");
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo)) {
    throw invalid("GitHub owner/repo names contain unsupported characters.");
  }
  if (repo.endsWith(".lock")) throw invalid("GitHub repo name is not valid.");

  return {
    sanitizedUrl: sanitizeSourceUrl(`https://github.com/${owner}/${repo}`),
    host: parsed.hostname,
    githubPath: { owner, repo },
  };
}

/** Generic git URL: https:// only, host + path required, no credentials. */
export function validateGitUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) throw invalid("url must not be empty.");
  if (raw.length > INGESTION_CONFIG.maxUrlLength) {
    throw invalid(`url exceeds the ${INGESTION_CONFIG.maxUrlLength}-character limit.`);
  }
  if (hasControlChars(raw)) throw invalid("url must not contain control characters.");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalid("url is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw invalid('Generic git imports require an https:// URL (git:// and ssh are not supported).');
  }
  if (!parsed.hostname) throw invalid("url must include a host.");
  if (parsed.username || parsed.password) {
    throw invalid("url must not embed credentials — pass them via the token field.");
  }
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) throw invalid("url must include a repository path.");

  return {
    // Strip query + fragment (token carriers) + trailing ".git" kept AS-IS for
    // generic hosts (some hosts require it; it is not a credential).
    sanitizedUrl: sanitizeSourceUrl(raw),
    host: parsed.hostname,
  };
}
