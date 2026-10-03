import { join } from "node:path";

/**
 * CodeMind X V2 — ingestion configuration (Phase 4, spec §3/§6).
 *
 * Every numeric guard is overridable via env (documented per field) and is a
 * REAL limit enforced by the ingestion code paths — nothing here is advisory.
 *
 * Environment variables:
 * - CODEMIND_INGESTION_MAX_FILE_BYTES   — per-file size limit (skip + count)
 * - CODEMIND_INGESTION_DISK_QUOTA_BYTES — per-workspace disk quota (abort job)
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Project root — the dev workspace this Next.js server runs from. */
export const PROJECT_ROOT = process.cwd();

/**
 * Root of all isolated ingestion workspaces:
 * `<projectRoot>/.ingestion-workspaces/<uuid>/`.
 * This dot-directory lives OUTSIDE the UI's allowlisted tree
 * (src/lib/server/repository-fs.ts ALLOWED_ROOTS), so imported checkouts are
 * never exposed through the workspace file APIs. Git-ignored (see .gitignore).
 */
export const INGESTION_ROOT = join(PROJECT_ROOT, ".ingestion-workspaces");

/** Staging directory for uploaded ZIP archives (deleted after extraction). */
export const INGESTION_UPLOAD_STAGING = join(INGESTION_ROOT, "uploads");

export const INGESTION_CONFIG = {
  /**
   * Per-file size limit for discovered/extracted files. Files above the limit
   * are SKIPPED AND COUNTED (never a job failure). Default 10 MB.
   */
  maxFileBytes: envInt("CODEMIND_INGESTION_MAX_FILE_BYTES", 10 * 1024 * 1024),

  /**
   * Disk quota per ingestion workspace (running total of cloned/extracted
   * bytes). Exceeding it aborts the job honestly with "disk quota exceeded".
   * Default 1 GB.
   */
  diskQuotaBytes: envInt("CODEMIND_INGESTION_DISK_QUOTA_BYTES", 1024 * 1024 * 1024),

  /** Hard cap on discovered files per workspace (RAM safety for huge trees). */
  maxFiles: 200_000,

  /** Maximum walk depth for discovery. */
  maxDepth: 32,

  /** Bytes read per file for the binary NUL sniff (spec: ≤ 64 KB buffers). */
  binarySniffBytes: 64 * 1024,

  zip: {
    /** Maximum entries per archive (spec §6). */
    maxEntries: 50_000,
    /** Maximum TOTAL uncompressed bytes per archive (spec §6: 512 MB). */
    maxTotalUncompressedBytes: 512 * 1024 * 1024,
    /** Maximum size per entry (spec §6: 25 MB) — enforced BEFORE inflation. */
    maxEntryUncompressedBytes: 25 * 1024 * 1024,
    /** Compression-ratio suspicion threshold (spec §6: > 200x → reject). */
    maxCompressionRatio: 200,
  },

  /** sparsePaths: max entries (spec §6: 20), each a relative prefix path. */
  maxSparsePaths: 20,
  maxSparsePathLength: 200,

  /** ref: branch | tag | commit — conservative git-safe charset + length. */
  maxRefLength: 200,

  /** URL length cap (validation-time rejection, keeps DB rows sane). */
  maxUrlLength: 2048,

  /** Pattern list caps for ignorePatterns/includePatterns. */
  maxPatterns: 50,
  maxPatternLength: 200,

  git: {
    /** Timeout for a single git invocation (big clones are the worst case). */
    commandTimeoutMs: 10 * 60 * 1000,
    /** Cancel-poll cadence while a git child process runs (spec: ~500 ms). */
    cancelPollMs: 500,
    /** Per-stream stdout/stderr capture cap (used only for sanitized errors). */
    maxOutputBytes: 64 * 1024,
  },

  /** Ephemeral token-vault TTL (see token-vault.ts) — imports, not sessions. */
  tokenVaultTtlMs: 60 * 60 * 1000,

  /**
   * Environment variable consulted for GitHub tokens when the request does
   * not carry one (precedence: request token wins — spec §1). The VALUE is
   * never persisted, logged, or echoed; only its PRESENCE is observable.
   */
  githubTokenEnv: "CODEMIND_GITHUB_TOKEN" as const,
} as const;
