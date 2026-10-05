import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ApiError } from "@/server/api/envelope";
import { logError } from "@/server/security/logger";

/**
 * CodeMind X V2 — real git inspection service (Phase 3, spec §4).
 *
 * Read-only child_process git calls against the workspace, exactly the
 * approach /api/repository/meta already uses (execFile + cwd + timeout).
 * No git state is persisted by these functions and nothing is fabricated:
 * if git fails, callers get an honest SERVICE_UNAVAILABLE ApiError.
 */

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const GIT_TIMEOUT_MS = 5_000;

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: PROJECT_ROOT,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout;
}

/** Current checked-out branch via `git rev-parse --abbrev-ref HEAD`, or null. */
export async function getCurrentBranch(): Promise<string | null> {
  try {
    const value = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    return value || null;
  } catch (error) {
    // Honest null: git unavailable / no commits — callers decide how to report.
    logError("git-service: rev-parse failed", { error: describeError(error) });
    return null;
  }
}

export interface BranchSummary {
  name: string;
  isDefault: boolean;
}

export interface BranchListResult {
  branches: BranchSummary[];
  current: string | null;
  /** How isDefault was derived — always stated, never implied. */
  note: string;
}

/**
 * Real local branches + current branch. Default-branch detection:
 * 1. `git symbolic-ref refs/remotes/origin/HEAD` (authoritative when set);
 * 2. otherwise the current branch is flagged, and the note says exactly that.
 */
export async function listBranches(): Promise<BranchListResult> {
  let names: string[];
  try {
    names = (await git(["for-each-ref", "refs/heads", "--format=%(refname:short)"]))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    logError("git-service: branch listing failed", { error: describeError(error) });
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "Git branch information is unavailable in this environment.",
      503,
    );
  }

  const current = await getCurrentBranch();

  let defaultBranch: string | null = null;
  let note: string;
  try {
    const head = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    defaultBranch = head.startsWith("origin/") ? head.slice("origin/".length) : head || null;
    note = "Default branch detected from origin HEAD.";
  } catch {
    defaultBranch = null;
    note =
      "No remote origin/HEAD reference found; the current checked-out branch is flagged as default.";
  }

  const effectiveDefault = defaultBranch ?? current;
  return {
    branches: names.map((name) => ({ name, isDefault: name === effectiveDefault })),
    current,
    note,
  };
}

export interface GitCommitSummary {
  sha: string;
  author: string;
  /** Author date, ISO 8601 (git %aI). */
  date: string;
  message: string;
}

export interface GitOverview {
  branch: string | null;
  commits: GitCommitSummary[];
}

/** Last `maxCount` commits via unit-separated `git log` output. */
export async function listRecentCommits(maxCount = 20): Promise<GitCommitSummary[]> {
  const stdout = await git([
    "log",
    `--max-count=${maxCount}`,
    "--pretty=format:%H%x1f%an%x1f%aI%x1f%s",
  ]);
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split("\x1f");
      return {
        sha: parts[0] ?? "",
        author: parts[1] ?? "",
        date: parts[2] ?? "",
        // Subject may itself contain the unit separator — rejoin it honestly.
        message: parts.slice(3).join("\x1f"),
      };
    });
}

/** Branch + recent commits for GET /api/git; any git failure → honest 503. */
export async function getGitOverview(): Promise<GitOverview> {
  try {
    const [branch, commits] = await Promise.all([getCurrentBranch(), listRecentCommits(20)]);
    if (branch === null && commits.length === 0) {
      throw new Error("git produced no branch and no commits");
    }
    return { branch, commits };
  } catch (error) {
    logError("git-service: overview failed", { error: describeError(error) });
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "Git history is unavailable in this environment.",
      503,
    );
  }
}
