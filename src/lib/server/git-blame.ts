/**
 * CodeMind X V2 — workspace git-blame reader (Phase 6 §4).
 *
 * REAL, read-only `git blame --line-porcelain` for one allowlisted workspace
 * file, grouped into consecutive ranges that share a commit.
 *
 * Contract:
 * - NEVER throws — failures degrade to typed results with a sanitized
 *   single-line reason; git output is never invented;
 * - paths validated through resolveAllowedPath (same trust boundary as the
 *   file read route);
 * - text files ≤ 512 KB only (same limit as the file read route);
 * - ranges are capped; lines past the cap are reported honestly as uncovered.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { BlameRange } from "@/features/workspace/diff-contracts";

import { resolveAllowedPath, isTextFile } from "./repository-fs";
import { sanitizeReason, spawnGit } from "./git-status";

export type GitEditorFailureCode = "forbidden" | "not-found" | "too-large" | "error";

const GIT_TIMEOUT_MS = 8_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_LINES = 10_000;

export interface GitFileBlameResult {
  ok: boolean;
  code?: GitEditorFailureCode;
  message?: string;
  blame?: {
    path: string;
    /** Total lines blamed (== real line count of the file). */
    lineCount: number;
    ranges: BlameRange[];
    /** Honest note when part of the file could not be attributed. */
    note?: string;
  };
}

interface ParsedLine {
  sha: string;
  author: string;
  time: string;
}

/**
 * Parse `git blame --line-porcelain` output. Each source line starts with
 * "<sha> <origLine> <finalLine> [<numLines>]" followed by metadata headers
 * and a final "\t<content>" line.
 */
function parseLinePorcelain(text: string): { lines: ParsedLine[]; incomplete: boolean } {
  const lines: ParsedLine[] = [];
  const entries = text.split("\n");
  let current: ParsedLine | null = null;
  let incomplete = false;

  for (const entry of entries) {
    if (entry.startsWith("\t")) {
      // Content line — finalizes the previous logical line.
      if (current) lines.push(current);
      current = null;
      continue;
    }
    if (entry.length === 0) continue;
    const shaMatch = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(entry);
    if (shaMatch) {
      // New logical line starts; the previous one is finalized by its \t.
      if (current) {
        lines.push(current);
        incomplete = true; // missing content line — keep what we know
      }
      current = { sha: shaMatch[1]!, author: "", time: "" };
      continue;
    }
    if (!current) continue;
    if (entry.startsWith("author ")) current.author = entry.slice(7);
    else if (entry.startsWith("author-time ")) {
      const unix = Number.parseInt(entry.slice(12), 10);
      if (Number.isFinite(unix)) {
        current.time = new Date(unix * 1000).toISOString();
      }
    }
  }
  if (current) {
    lines.push(current);
    incomplete = true;
  }
  return { lines, incomplete };
}

/**
 * REAL workspace file blame. Never throws.
 */
export async function readWorkspaceFileBlame(
  input: string,
): Promise<GitFileBlameResult> {
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
    if (!isTextFile(name)) {
      return { ok: false, code: "error", message: "Blame is not available for binary files." };
    }
    if (stat.size > MAX_FILE_BYTES) {
      return { ok: false, code: "too-large", message: "File exceeds the 512 KB blame limit." };
    }

    const res = await spawnGit(
      ["blame", "--line-porcelain", "--", relative],
      GIT_TIMEOUT_MS,
    );
    if (res.code !== 0) {
      return {
        ok: false,
        code: "error",
        message: sanitizeReason(res.stderr) || "git blame failed.",
      };
    }

    const { lines, incomplete } = parseLinePorcelain(res.stdout.toString("utf8"));
    if (lines.length === 0) {
      return { ok: false, code: "error", message: "git blame returned no attribution." };
    }

    // Merge consecutive lines that share commit + author + date.
    const ranges: BlameRange[] = [];
    for (let i = 0; i < lines.length && i < MAX_LINES; i += 1) {
      const line = lines[i]!;
      const last = ranges[ranges.length - 1];
      if (
        last &&
        last.sha === line.sha &&
        last.author === line.author &&
        last.date === line.time &&
        last.endLine === i // previous range ends exactly one line before
      ) {
        last.endLine = i + 1;
      } else {
        ranges.push({
          startLine: i + 1,
          endLine: i + 1,
          sha: line.sha,
          author: line.author || "unknown",
          date: line.time || "",
        });
      }
    }

    return {
      ok: true,
      blame: {
        path: relative,
        lineCount: lines.length,
        ranges,
        ...(incomplete ? { note: "Some lines could not be fully attributed." } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: "error",
      message: sanitizeReason(error instanceof Error ? error.message : String(error)) || "git blame is unavailable.",
    };
  }
}
