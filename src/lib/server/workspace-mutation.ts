/**
 * CodeMind X V2 — Agent Mode V2 workspace mutation service (spec §9/§15/§16/
 * §17/§102/§103/§135).
 *
 * THE application-level mutation layer. No agent and no LLM ever writes to
 * the repository directly: every proposed change that a human approves is
 * executed HERE, with real filesystem semantics:
 *
 * - path security: every path goes through resolveAllowedPath (the same
 *   allowlist boundary the read surface uses — traversal, absolute paths
 *   outside the workspace, dotfiles, .env*, db/ and upload/ are rejected);
 * - pre-write snapshot: hash + size captured before any byte is written;
 * - conflict safety: callers compare the captured baseHash against the
 *   proposal-time hash — a file that changed after the proposal is never
 *   overwritten (spec §17/§43);
 * - post-write verification: EVERY mutation is re-read from disk and
 *   byte-compared against the expected content (spec §16 — never trust the
 *   write call alone); an edit that produces identical bytes is a NO-OP
 *   failure, not a success (spec §18/§84);
 * - honest results: every operation returns a structured result the run
 *   can surface verbatim — failures never masquerade as success.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  invalidateWorkspaceTreeCache,
  resolveAllowedPath,
  type PathCheckResult,
} from "./repository-fs";

/* ------------------------------------------------------------------ */
/* Mutation path boundary (spec §103)                                  */
/*                                                                     */
/* The READ surface allowlists a handful of roots. The MUTATION surface  */
/* accepts the WHOLE workspace root (the agent must be able to create   */
/* new top-level folders/files) but hard-denies everything dangerous:   */
/* hidden paths, dotfiles, env files, the database, uploads, runtime    */
/* directories (node_modules/.next/.git) and the ingestion sandbox.     */
/* Traversal, absolute escapes and NUL are rejected exactly like reads. */
/* ------------------------------------------------------------------ */

const MUTATION_DENYLIST: RegExp[] = [
  /^\.env($|[./])/i,
  /^node_modules(\/|$)/,
  /^\.next(\/|$)/,
  /^\.git(\/|$)/,
  /^\.turbo(\/|$)/,
  /^db(\/|$)/,
  /^upload(\/|$)/,
  /^\.ingestion-workspaces(\/|$)/,
  /^\.zscripts(\/|$)/,
  /^\.agent-ctx(\/|$)/,
  /^dist(\/|$)/,
  /^build(\/|$)/,
  /^coverage(\/|$)/,
  /^playwright-report(\/|$)/,
  /^test-results(\/|$)/,
];

/**
 * Normalize + boundary-check a path for MUTATION. Same normalization and
 * segment rules as the read boundary (resolveAllowedPath) — traversal,
 * absolute escapes, hidden segments and NUL are rejected — but the root
 * allowlist is replaced by the mutation denylist above.
 */
export function resolveMutationPath(input: string): PathCheckResult {
  const readCheck = resolveAllowedPath(input);
  // Everything the read boundary already accepts is mutation-safe too.
  if (readCheck.ok) return readCheck;

  if (typeof input !== "string") return { ok: false };
  const cleaned = input.trim().replace(/\\/g, "/");
  if (!cleaned || cleaned.length > 512) return { ok: false };
  if (cleaned.includes("\0")) return { ok: false };

  const projectRoot = process.cwd();
  const absolute = path.resolve(projectRoot, cleaned);
  if (absolute !== projectRoot && !absolute.startsWith(projectRoot + path.sep)) {
    return { ok: false };
  }
  const relative = path.relative(projectRoot, absolute).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..")) return { ok: false };
  const segments = relative.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return { ok: false };
    if (seg.startsWith(".")) return { ok: false };
  }
  for (const deny of MUTATION_DENYLIST) {
    if (deny.test(relative)) return { ok: false };
  }
  return { ok: true, absolute, relative };
}

/** sha256 of a string (hex) — the proposal/apply version marker. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** One pre-write snapshot of an existing file (null when it does not exist). */
export interface FileSnapshot {
  path: string;
  exists: boolean;
  size: number;
  hash: string | null;
}

/** Capture path/hash/size for a path (missing file → exists:false). */
export async function snapshotFile(relativePath: string): Promise<FileSnapshot> {
  const check = resolveMutationPath(relativePath);
  if (!check.ok) {
    return { path: relativePath, exists: false, size: 0, hash: null };
  }
  try {
    const info = await stat(check.absolute);
    if (!info.isFile()) {
      return { path: relativePath, exists: false, size: 0, hash: null };
    }
    const content = await readFile(check.absolute, "utf8");
    return {
      path: relativePath,
      exists: true,
      size: info.size,
      hash: contentHash(content),
    };
  } catch {
    return { path: relativePath, exists: false, size: 0, hash: null };
  }
}

/** Honest per-operation result — never thrown away, never dressed up. */
export interface MutationResult {
  ok: boolean;
  path: string;
  operation: "create-folder" | "create-file" | "write-file" | "delete-file" | "rename-file";
  /** Disk truth after the operation (re-read, not assumed). */
  verified: boolean;
  hashBefore: string | null;
  hashAfter: string | null;
  bytes: number;
  /** Machine-checkable failure reason (safe to surface). */
  error: string | null;
  /** True when the write landed but produced byte-identical content. */
  noOp?: boolean;
}

/** Verify an expected file body is EXACTLY what is on disk right now. */
async function verifyFileContent(
  absolutePath: string,
  expectedContent: string,
): Promise<{ verified: boolean; hash: string | null; actual: string | null }> {
  try {
    const actual = await readFile(absolutePath, "utf8");
    return {
      verified: actual === expectedContent,
      hash: contentHash(actual),
      actual,
    };
  } catch {
    return { verified: false, hash: null, actual: null };
  }
}

/** Create a folder (recursively). Succeeds when it already exists. */
export async function createFolder(relativePath: string): Promise<MutationResult> {
  const check = resolveMutationPath(relativePath);
  if (!check.ok) {
    return {
      ok: false,
      path: relativePath,
      operation: "create-folder",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: "path is outside the allowed workspace roots",
    };
  }
  try {
    await mkdir(check.absolute, { recursive: true });
    const info = await stat(check.absolute);
    const verified = info.isDirectory();
    return {
      ok: verified,
      path: relativePath,
      operation: "create-folder",
      verified,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: verified ? null : "folder could not be created",
    };
  } catch (error) {
    return {
      ok: false,
      path: relativePath,
      operation: "create-folder",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: error instanceof Error ? error.message : "mkdir failed",
    };
  }
}

/**
 * Create a file with the exact content. Fails honestly when the file
 * already exists (use write-file for approved overwrites of a snapshot).
 */
export async function createFile(
  relativePath: string,
  content: string,
): Promise<MutationResult> {
  const check = resolveMutationPath(relativePath);
  if (!check.ok) {
    return {
      ok: false,
      path: relativePath,
      operation: "create-file",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: "path is outside the allowed workspace roots",
    };
  }
  const before = await snapshotFile(relativePath);
  if (before.exists) {
    return {
      ok: false,
      path: relativePath,
      operation: "create-file",
      verified: false,
      hashBefore: before.hash,
      hashAfter: null,
      bytes: 0,
      error: "file already exists — refusing to overwrite a 'create' operation",
    };
  }
  try {
    await mkdir(path.dirname(check.absolute), { recursive: true });
    await writeFile(check.absolute, content, "utf8");
    // The file list changed on disk — the explorer must see it immediately.
    invalidateWorkspaceTreeCache();
    const after = await verifyFileContent(check.absolute, content);
    return {
      ok: after.verified,
      path: relativePath,
      operation: "create-file",
      verified: after.verified,
      hashBefore: null,
      hashAfter: after.hash,
      bytes: Buffer.byteLength(content, "utf8"),
      error: after.verified
        ? null
        : "post-write re-read did not match the expected content",
    };
  } catch (error) {
    return {
      ok: false,
      path: relativePath,
      operation: "create-file",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: error instanceof Error ? error.message : "write failed",
    };
  }
}

/**
 * Overwrite an existing file with the exact approved content.
 * `expectedBaseHash` is the proposal-time hash: when the live file hash
 * differs, the write is REFUSED (the file changed after the proposal —
 * spec §17/§43; the caller re-plans). When the new content equals the
 * current content the result is an honest NO-OP (spec §84).
 */
export async function writeFileContent(
  relativePath: string,
  content: string,
  expectedBaseHash: string | null,
): Promise<MutationResult> {
  const check = resolveMutationPath(relativePath);
  if (!check.ok) {
    return {
      ok: false,
      path: relativePath,
      operation: "write-file",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: "path is outside the allowed workspace roots",
    };
  }
  const before = await snapshotFile(relativePath);
  if (!before.exists) {
    return {
      ok: false,
      path: relativePath,
      operation: "write-file",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: "file no longer exists — it changed after the proposal",
    };
  }
  if (expectedBaseHash && before.hash && before.hash !== expectedBaseHash) {
    return {
      ok: false,
      path: relativePath,
      operation: "write-file",
      verified: false,
      hashBefore: before.hash,
      hashAfter: null,
      bytes: 0,
      error: "version conflict — the file changed after the proposal was prepared",
    };
  }
  if (before.hash && before.hash === contentHash(content)) {
    return {
      ok: false,
      path: relativePath,
      operation: "write-file",
      verified: true,
      hashBefore: before.hash,
      hashAfter: before.hash,
      bytes: before.size,
      error: "no-op — the proposed content is identical to the current file",
      noOp: true,
    };
  }
  try {
    await writeFile(check.absolute, content, "utf8");
    invalidateWorkspaceTreeCache();
    const after = await verifyFileContent(check.absolute, content);
    return {
      ok: after.verified,
      path: relativePath,
      operation: "write-file",
      verified: after.verified,
      hashBefore: before.hash,
      hashAfter: after.hash,
      bytes: Buffer.byteLength(content, "utf8"),
      error: after.verified
        ? null
        : "post-write re-read did not match the expected content",
    };
  } catch (error) {
    return {
      ok: false,
      path: relativePath,
      operation: "write-file",
      verified: false,
      hashBefore: before.hash,
      hashAfter: null,
      bytes: 0,
      error: error instanceof Error ? error.message : "write failed",
    };
  }
}

/**
 * Delete a file (never a folder — folder deletion stays out of the agent's
 * reach this phase). `expectedBaseHash` guards against concurrent edits.
 */
export async function deleteFile(
  relativePath: string,
  expectedBaseHash: string | null,
): Promise<MutationResult> {
  const check = resolveMutationPath(relativePath);
  if (!check.ok) {
    return {
      ok: false,
      path: relativePath,
      operation: "delete-file",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: "path is outside the allowed workspace roots",
    };
  }
  const before = await snapshotFile(relativePath);
  if (!before.exists) {
    return {
      ok: false,
      path: relativePath,
      operation: "delete-file",
      verified: false,
      hashBefore: null,
      hashAfter: null,
      bytes: 0,
      error: "file does not exist",
    };
  }
  if (expectedBaseHash && before.hash && before.hash !== expectedBaseHash) {
    return {
      ok: false,
      path: relativePath,
      operation: "delete-file",
      verified: false,
      hashBefore: before.hash,
      hashAfter: null,
      bytes: 0,
      error: "version conflict — the file changed after the proposal was prepared",
    };
  }
  try {
    await rm(check.absolute, { force: false });
    invalidateWorkspaceTreeCache();
    let gone = false;
    try {
      await stat(check.absolute);
    } catch {
      gone = true;
    }
    return {
      ok: gone,
      path: relativePath,
      operation: "delete-file",
      verified: gone,
      hashBefore: before.hash,
      hashAfter: null,
      bytes: before.size,
      error: gone ? null : "file still exists after delete",
    };
  } catch (error) {
    return {
      ok: false,
      path: relativePath,
      operation: "delete-file",
      verified: false,
      hashBefore: before.hash,
      hashAfter: null,
      bytes: 0,
      error: error instanceof Error ? error.message : "delete failed",
    };
  }
}

/**
 * Rename/move a file within the workspace (both endpoints validated).
 * Content is verified unchanged after the move (spec §62).
 */
export async function renameFile(
  fromPath: string,
  toPath: string,
): Promise<MutationResult & { to: string }> {
  const from = resolveMutationPath(fromPath);
  const to = resolveMutationPath(toPath);
  const base = {
    path: fromPath,
    verified: false,
    hashBefore: null as string | null,
    hashAfter: null as string | null,
    bytes: 0,
  };
  if (!from.ok || !to.ok) {
    return {
      ...base,
      operation: "rename-file",
      ok: false,
      to: toPath,
      error: "path is outside the allowed workspace roots",
    };
  }
  const before = await snapshotFile(fromPath);
  if (!before.exists) {
    return {
      ...base,
      operation: "rename-file",
      ok: false,
      to: toPath,
      error: "source file does not exist",
    };
  }
  const target = await snapshotFile(toPath);
  if (target.exists) {
    return {
      ...base,
      operation: "rename-file",
      ok: false,
      to: toPath,
      error: "target path already exists",
    };
  }
  try {
    await mkdir(path.dirname(to.absolute), { recursive: true });
    await rename(from.absolute, to.absolute);
    invalidateWorkspaceTreeCache();
    const after = await snapshotFile(toPath);
    const verified = after.exists && after.hash !== null && after.hash === before.hash;
    let sourceGone = false;
    try {
      await stat(from.absolute);
    } catch {
      sourceGone = true;
    }
    return {
      ...base,
      operation: "rename-file",
      ok: verified && sourceGone,
      verified: verified && sourceGone,
      hashBefore: before.hash,
      hashAfter: after.hash,
      bytes: after.size,
      to: toPath,
      error: verified && sourceGone ? null : "rename could not be verified on disk",
    };
  } catch (error) {
    return {
      ...base,
      operation: "rename-file",
      ok: false,
      to: toPath,
      error: error instanceof Error ? error.message : "rename failed",
    };
  }
}

/** One side of a unified-diff hunk. */
export interface DiffLine {
  kind: "add" | "remove" | "same";
  text: string;
}

/**
 * A small honest LINE diff (LCS) computed from real before/after content —
 * used for the approval review and the chat result card. Never fabricated:
 * both sides come from actual file reads.
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // LCS table (bounded — proposals cap file sizes at the read service limit).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: "remove", text: a[i] ?? "" });
      i += 1;
    } else {
      lines.push({ kind: "add", text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ kind: "remove", text: a[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    lines.push({ kind: "add", text: b[j] ?? "" });
    j += 1;
  }
  return lines;
}
