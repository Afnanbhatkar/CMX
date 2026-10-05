/**
 * CodeMind X V2 — file provenance service (Phase 5, V2.1).
 *
 * REAL, read-only provenance for ONE allowlisted workspace file: identity
 * (path/language/size), binary-ness (8 KB NUL sniff — NEVER a full read),
 * MIME type, and git facts (worktree status, branch/HEAD, last commit that
 * touched the path, follow-history). Every git fact degrades to an honest
 * null/empty on failure — nothing is ever fabricated (RULES.md §9).
 *
 * The language map below mirrors src/lib/server/repository-fs.ts deliberately
 * (same style as src/server/ingestion/discovery.ts — local copy instead of an
 * import, keeping that module's surface untouched).
 */

import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import { resolveAllowedPath } from "@/lib/server/repository-fs";

import { readWorkspaceGitStatus, readWorkspaceHead, type WorkspaceGitStatus } from "@/lib/server/git-status";

export type FileProvenanceGitStatus = WorkspaceGitStatus;

export interface FileProvenance {
  path: string;
  language: string;
  size: number;
  /**
   * True when the file exceeds the 512 KB workspace text-read cap (a content
   * preview would be truncated). Provenance itself NEVER reads full content.
   */
  truncated: boolean;
  binary: boolean;
  mimeType: string | null;
  gitStatus: FileProvenanceGitStatus | null;
  branch: string | null;
  commitSha: string | null;
  /** ISO author date (%aI) of the last commit touching the path; honest null. */
  lastModifiedAt: string | null;
}

export type ProvenanceFailureCode =
  | "not-found"
  | "forbidden"
  | "too-large"
  | "binary"
  | "error";

export interface GitCommitInfo {
  sha: string;
  author: string;
  /** Author date, ISO 8601 (git %aI). */
  date: string;
  /** Single-line subject (git %s, sanitized). */
  message: string;
}

const PROJECT_ROOT = process.cwd();
const GIT_TIMEOUT_MS = 3_000;
const LOG_TIMEOUT_MS = 2_000;
const SNIFF_BYTES = 8_192;
const TEXT_READ_CAP_BYTES = 512 * 1024;
const MAX_HISTORY = 20;

/* ------------------------------------------------------------------ */
/* Local language map (style-sync copy of repository-fs.ts)             */
/* ------------------------------------------------------------------ */

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".prisma": "prisma",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".svg": "xml",
  ".txt": "text",
};

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function languageForPath(p: string): string {
  return LANGUAGE_BY_EXT[extOf(p)] ?? "text";
}

/* ------------------------------------------------------------------ */
/* MIME map (small, common types; honest null when unknown text)        */
/* ------------------------------------------------------------------ */

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".rst": "text/x-rst",
  ".adoc": "text/asciidoc",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".tar": "application/x-tar",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".sh": "text/x-shellscript",
  ".py": "text/x-python",
  ".sql": "application/sql",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const BINARY_MIME_FALLBACK = "application/octet-stream";

function mimeForPath(p: string, binary: boolean): string | null {
  const mime = MIME_BY_EXT[extOf(p)];
  if (mime) return mime;
  return binary ? BINARY_MIME_FALLBACK : null; // unknown text → honest null
}

/* ------------------------------------------------------------------ */
/* Small spawn helper (same hygiene as git-status.ts)                   */
/* ------------------------------------------------------------------ */

function sanitizeField(raw: string, maxLength: number): string {
  const singleLine = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return singleLine.length > maxLength ? singleLine.slice(0, maxLength) + "..." : singleLine;
}

interface GitSpawnResult {
  code: number;
  stdout: string;
}

function spawnGit(args: string[], timeoutMs: number): Promise<GitSpawnResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (result: GitSpawnResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", args, {
        cwd: PROJECT_ROOT,
        shell: false,
        signal: AbortSignal.timeout(timeoutMs),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      settleReject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const stdout: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk).toString("utf8")));
    child.on("error", (error: Error) => settleReject(error));
    child.on("close", (code) => settleResolve({ code: typeof code === "number" ? code : -1, stdout: stdout.join("") }));
  });
}

/** Last commit date (%aI) touching the path; honest null on any failure. */
async function lastModifiedAt(relativePath: string): Promise<string | null> {
  try {
    const res = await spawnGit(
      ["log", "-1", "--format=%aI", "--", relativePath],
      LOG_TIMEOUT_MS,
    );
    if (res.code !== 0) return null;
    const value = sanitizeField(res.stdout, 40);
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null; // real ISO or nothing
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Provenance                                                           */
/* ------------------------------------------------------------------ */

export interface ProvenanceSuccess {
  ok: true;
  provenance: FileProvenance;
}
export interface ProvenanceFailure {
  ok: false;
  code: ProvenanceFailureCode;
  message?: string;
}

/**
 * Provenance for one allowlisted workspace-relative path. Never reads the
 * full file — at most the first SNIFF_BYTES for the NUL check.
 */
export async function readFileProvenance(relativePath: string): Promise<ProvenanceSuccess | ProvenanceFailure> {
  const check = resolveAllowedPath(relativePath);
  if (!check.ok) return { ok: false, code: "forbidden" };

  let stat;
  try {
    stat = await fs.stat(check.absolute);
  } catch {
    return { ok: false, code: "not-found" };
  }
  if (!stat.isFile()) return { ok: false, code: "forbidden" };

  // Binary = extension outside the language map OR a NUL in the first 8 KB
  // (mirror of repository-fs readWorkspaceFile logic; content is never kept).
  let head: Buffer | null = null;
  try {
    const handle = await fs.open(check.absolute, "r");
    try {
      const buffer = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    head = null; // unreadable head → fall back to the extension verdict
  }
  const binary = !(extOf(check.relative) in LANGUAGE_BY_EXT) || (head !== null && head.includes(0));

  // Git facts — every one degrades honestly.
  const [status, head2] = await Promise.all([readWorkspaceGitStatus(), readWorkspaceHead()]);
  const gitStatus = status.ok ? (status.status[check.relative] ?? null) : null;
  const lastModified = await lastModifiedAt(check.relative);

  const provenance: FileProvenance = {
    path: check.relative,
    language: binary ? "binary" : languageForPath(check.relative),
    size: stat.size,
    truncated: stat.size > TEXT_READ_CAP_BYTES,
    binary,
    mimeType: mimeForPath(check.relative, binary),
    gitStatus,
    branch: head2.branch,
    commitSha: head2.headSha,
    lastModifiedAt: lastModified,
  };
  return { ok: true, provenance };
}

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

export interface HistorySuccess {
  ok: true;
  commits: GitCommitInfo[];
}
export interface HistoryFailure {
  ok: false;
  code: "not-found" | "forbidden" | "error";
  message?: string;
}

/**
 * Follow-history for one allowlisted path (`git log --follow`, unit-separated
 * format parsed like /api/git). Capped at MAX_HISTORY commits; every field is
 * sanitized single-line. Not-found when path validation fails; git failures
 * degrade to { ok:false, code:"error" } — never fabricated commits.
 */
export async function readFileHistory(relativePath: string, limit?: number): Promise<HistorySuccess | HistoryFailure> {
  const check = resolveAllowedPath(relativePath);
  if (!check.ok) return { ok: false, code: "not-found" };

  const requested = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : MAX_HISTORY;
  const maxCount = Math.min(MAX_HISTORY, Math.max(1, requested));

  let res: GitSpawnResult;
  try {
    res = await spawnGit(
      [
        "log",
        "--follow",
        `--max-count=${maxCount}`,
        "--format=%H%x1f%an%x1f%aI%x1f%s",
        "--",
        check.relative,
      ],
      GIT_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      code: "error",
      message: sanitizeField(error instanceof Error ? error.message : String(error), 200),
    };
  }
  if (res.code !== 0) {
    // Not a repository / git unavailable — honest error, no fabricated rows.
    return { ok: false, code: "error", message: "git history is unavailable for this path." };
  }

  const commits = res.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split("\x1f");
      return {
        sha: sanitizeField(parts[0] ?? "", 64),
        author: sanitizeField(parts[1] ?? "", 200),
        date: sanitizeField(parts[2] ?? "", 40),
        // Subject may itself contain the unit separator — rejoin honestly.
        message: sanitizeField(parts.slice(3).join("\x1f"), 500),
      };
    })
    .filter((c) => c.sha.length > 0);

  return { ok: true, commits };
}
