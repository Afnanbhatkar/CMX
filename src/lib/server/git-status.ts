/**
 * CodeMind X V2 — workspace git-status reader (Phase 5, V2.1).
 *
 * REAL, read-only git facts for the canonical workspace: `git status
 * --porcelain=v1 -z --untracked-files=all` + `git rev-parse` for branch/head.
 * Contract:
 * - NEVER throws — any failure degrades to { ok:false, status:{}, branch:null,
 *   headSha:null, reason } with a sanitized single-line reason (no stack, no
 *   raw multi-line stderr);
 * - status keys are repo-relative POSIX paths; renames key the NEW path;
 * - an empty/clean worktree is ok:true with an empty status map;
 * - branch/headSha are cached 30 s module-level (same spirit as the tree
 *   cache in repository-fs.ts) and are honest nulls when git is unavailable.
 *
 * Process hygiene (Phase 4 lesson): argv-array spawn with shell:false (no
 * shell interpretation), AbortSignal timeout, and a SINGLE settle invariant —
 * every path resolves/rejects exactly once.
 */

import { spawn } from "node:child_process";

export type WorkspaceGitStatus = "modified" | "added" | "deleted" | "untracked" | "renamed";

export interface GitStatusResult {
  ok: boolean;
  /** Repo-relative posix paths → status. Empty map = clean/unknown. */
  status: Record<string, WorkspaceGitStatus>;
  branch: string | null;
  headSha: string | null;
  /** Sanitized single-line reason; present only when ok=false. */
  reason?: string;
}

const PROJECT_ROOT = process.cwd();
const GIT_TIMEOUT_MS = 3_000;
const HEAD_CACHE_MS = 30_000;
const MAX_REASON_LENGTH = 200;

/** Single-line, length-capped, control-character-free reason text. */
export function sanitizeReason(raw: string): string {
  const singleLine = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return singleLine.length > MAX_REASON_LENGTH
    ? singleLine.slice(0, MAX_REASON_LENGTH) + "..."
    : singleLine;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface GitSpawnResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Spawn git with an argv array (never a shell string) + hard timeout. */
export function spawnGit(args: string[], timeoutMs: number): Promise<GitSpawnResult> {
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
      settleReject(error instanceof Error ? error : new Error(describeError(error)));
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk).toString("utf8")));
    child.on("error", (error: Error) => settleReject(error));
    child.on("close", (code) =>
      settleResolve({
        code: typeof code === "number" ? code : -1,
        stdout: Buffer.concat(stdout),
        stderr: stderr.join(""),
      }),
    );
  });
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Parse `git status --porcelain=v1 -z` output: NUL-separated entries of
 * "XY path\0" (renames/copies: "XY new\0old\0"). Priority when both XY carry
 * codes: D → deleted, A → added, R (and the rare C) → renamed, else modified;
 * "??" → untracked.
 */
function parsePorcelainZ(buffer: Buffer): Record<string, WorkspaceGitStatus> {
  const status: Record<string, WorkspaceGitStatus> = {};
  const entries = buffer.toString("utf8").split("\0");
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4 || entry[2] !== " ") continue; // malformed — skip honestly
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      i += 1; // two-path entry: consume the ORIGINAL path segment
    }

    let mapped: WorkspaceGitStatus;
    if (x === "?" && y === "?") mapped = "untracked";
    else if (x === "D" || y === "D") mapped = "deleted";
    else if (x === "A" || y === "A") mapped = "added";
    else if (x === "R" || y === "R" || x === "C" || y === "C") mapped = "renamed";
    else mapped = "modified";

    if (path.length > 0) status[normalizePath(path)] = mapped;
  }
  return status;
}

/* ------------------------------------------------------------------ */
/* Branch/head (30 s cache, shared with the provenance service)         */
/* ------------------------------------------------------------------ */

let headCache: {
  at: number;
  value: { branch: string | null; headSha: string | null };
} | null = null;

/**
 * Cached workspace branch + HEAD sha (honest nulls when git is unavailable
 * or the repository has no commits yet). Never throws.
 */
export async function readWorkspaceHead(): Promise<{
  branch: string | null;
  headSha: string | null;
}> {
  if (headCache && Date.now() - headCache.at < HEAD_CACHE_MS) return headCache.value;

  const value: { branch: string | null; headSha: string | null } = {
    branch: null,
    headSha: null,
  };
  try {
    const branchRes = await spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], GIT_TIMEOUT_MS);
    if (branchRes.code === 0) {
      const branch = branchRes.stdout.toString("utf8").trim();
      if (branch) value.branch = branch;
    }
    const shaRes = await spawnGit(["rev-parse", "HEAD"], GIT_TIMEOUT_MS);
    if (shaRes.code === 0) {
      const sha = shaRes.stdout.toString("utf8").trim();
      if (/^[0-9a-f]{7,64}$/i.test(sha)) value.headSha = sha;
    }
  } catch {
    // honest nulls — git unavailable / not a repository
  }
  headCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/**
 * REAL workspace git status. Never throws; any failure is an honest
 * { ok:false, status:{}, branch:null, headSha:null, reason } result.
 */
export async function readWorkspaceGitStatus(): Promise<GitStatusResult> {
  try {
    const res = await spawnGit(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      GIT_TIMEOUT_MS,
    );
    if (res.code !== 0) {
      const reason = sanitizeReason(res.stderr) || "git status failed.";
      return { ok: false, status: {}, branch: null, headSha: null, reason };
    }
    const head = await readWorkspaceHead();
    return { ok: true, status: parsePorcelainZ(res.stdout), branch: head.branch, headSha: head.headSha };
  } catch (error) {
    const reason = sanitizeReason(describeError(error)) || "git status is unavailable.";
    return { ok: false, status: {}, branch: null, headSha: null, reason };
  }
}
