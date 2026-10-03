/**
 * CodeMind X V2 — workspace git-diff reader (Phase 6 §4).
 *
 * REAL, read-only git facts for the git-aware editor:
 * - `git diff --unified=0 --no-color -- <path>` parsed into changed-line hunks,
 * - `git show HEAD:<path>` as the committed baseline text for the DiffViewer.
 *
 * Contract (mirrors git-status.ts / file-provenance.ts):
 * - NEVER throws — failures degrade to typed results with a sanitized
 *   single-line reason; a git failure NEVER yields invented hunks;
 * - paths are validated through resolveAllowedPath (the same trust boundary
 *   as the file read route);
 * - binary files report an honest note instead of a pseudo diff;
 * - the baseline text is capped at 512 KB (matching the file read limit).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { DiffHunk } from "@/features/workspace/diff-contracts";

import { resolveAllowedPath, isTextFile } from "./repository-fs";
import { readWorkspaceHead, sanitizeReason, spawnGit } from "./git-status";

export type GitEditorFailureCode = "forbidden" | "not-found" | "too-large" | "error";

const GIT_TIMEOUT_MS = 5_000;
const MAX_REASON_LENGTH = 200;
/** Baseline text cap — matches the file read route's 512 KB preview limit. */
const MAX_ORIGINAL_BYTES = 512 * 1024;
const MAX_HUNKS = 5_000;

export interface GitFileDiffResult {
  ok: boolean;
  code?: GitEditorFailureCode;
  message?: string;
  diff?: {
    path: string;
    branch: string | null;
    headSha: string | null;
    /** The file exists in HEAD (a committed baseline is available). */
    hasOriginal: boolean;
    /** Real `git show HEAD:<path>` text (≤ 512 KB) when hasOriginal. */
    original?: string;
    /** Parsed `git diff --unified=0` hunks — empty when unchanged. */
    hunks: DiffHunk[];
    /** Working-tree status of the path (real, from this diff computation). */
    changed: boolean;
    /** Honest note (binary file, untracked file, oversized baseline…). */
    note?: string;
  };
}

/** `git show HEAD:<path>` with the path encoded so weird filenames survive. */
async function readHeadFile(repoPath: string): Promise<string | null> {
  const res = await spawnGit(["show", `HEAD:${repoPath}`], GIT_TIMEOUT_MS);
  if (res.code !== 0) return null;
  return res.stdout.toString("utf8");
}

/**
 * REAL workspace file diff. Never throws.
 */
export async function readWorkspaceFileDiff(
  input: string,
): Promise<GitFileDiffResult> {
  try {
    const check = resolveAllowedPath(input);
    if (!check.ok) {
      return { ok: false, code: "forbidden", message: "Path is outside the workspace." };
    }
    const absolute = check.absolute;
    const relative = check.relative;
    const name = path.posix.basename(relative);

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolute);
    } catch {
      return { ok: false, code: "not-found", message: "File does not exist." };
    }
    if (!stat.isFile()) {
      return { ok: false, code: "not-found", message: "Not a file." };
    }

    const head = await readWorkspaceHead();

    // Binary files: honest note, no pseudo diff, ever.
    if (!isTextFile(name)) {
      return {
        ok: true,
        diff: {
          path: relative,
          branch: head.branch,
          headSha: head.headSha,
          hasOriginal: false,
          hunks: [],
          changed: false,
          note: "Diff is not available for binary files.",
        },
      };
    }
    if (stat.size > MAX_ORIGINAL_BYTES) {
      return {
        ok: true,
        diff: {
          path: relative,
          branch: head.branch,
          headSha: head.headSha,
          hasOriginal: false,
          hunks: [],
          changed: false,
          note: "File exceeds the 512 KB diff limit.",
        },
      };
    }

    // Is there a committed baseline at all (tracked file)?
    const catFile = await spawnGit(["cat-file", "-e", `HEAD:${relative}`], GIT_TIMEOUT_MS);
    const hasOriginal = catFile.code === 0;

    // Hunk headers from the real worktree diff (unified=0 → exact line ranges).
    const diffRes = await spawnGit(
      ["diff", "--unified=0", "--no-color", "--", relative],
      GIT_TIMEOUT_MS,
    );
    const hunks: DiffHunk[] = [];
    let changed = false;
    if (diffRes.code === 0) {
      const text = diffRes.stdout.toString("utf8");
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
      let match: RegExpExecArray | null;
      while ((match = header.exec(text)) !== null && hunks.length < MAX_HUNKS) {
        const oldStart = Number.parseInt(match[1] ?? "0", 10);
        const oldLines = match[2] ? Number.parseInt(match[2], 10) : 1;
        const newStart = Number.parseInt(match[3] ?? "0", 10);
        const newLines = match[4] ? Number.parseInt(match[4], 10) : 1;
        hunks.push({ oldStart, oldLines, newStart, newLines });
      }
      changed = hunks.length > 0;
    } else {
      return {
        ok: false,
        code: "error",
        message: sanitizeReason(diffRes.stderr) || "git diff failed.",
      };
    }

    // Baseline text — real HEAD content, size-capped.
    let original: string | undefined;
    let note: string | undefined;
    if (hasOriginal) {
      const headText = await readHeadFile(relative);
      if (headText !== null && Buffer.byteLength(headText, "utf8") <= MAX_ORIGINAL_BYTES) {
        original = headText;
      } else if (headText === null) {
        note = "Committed baseline is unavailable in this repository state.";
      } else {
        note = "Committed baseline exceeds the 512 KB diff limit.";
      }
    } else {
      note = "Untracked file — no committed baseline to diff against.";
    }

    return {
      ok: true,
      diff: {
        path: relative,
        branch: head.branch,
        headSha: head.headSha,
        hasOriginal,
        ...(original !== undefined ? { original } : {}),
        hunks,
        changed,
        ...(note ? { note } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: "error",
      message: sanitizeReason(error instanceof Error ? error.message : String(error)) || "git diff is unavailable.",
    };
  }
}
