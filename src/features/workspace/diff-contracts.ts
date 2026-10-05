/**
 * CodeMind X V2 — shared diff contracts (Phase 6 §10).
 *
 * The ONE diff vocabulary consumed by the DiffViewer component and by every
 * future AI coding phase (approvals, patches, apply flows). Data placed in
 * these shapes must be REAL (produced by git or by an actual AI response) —
 * nothing here is ever fabricated.
 */

/** What happened to a file in a change set. */
export type ChangeOperation = "create" | "modify" | "delete" | "rename";

/**
 * One file-level change. At least one of `original` / `proposed` / `diff`
 * must be present for a meaningful render:
 * - `original` — the real baseline text (e.g. git HEAD content),
 * - `proposed` — the real proposed text (e.g. an AI response),
 * - `diff`     — a unified diff when full texts are unavailable/unnecessary.
 */
export interface FileChange {
  /** Workspace-relative file path (the NEW path for renames). */
  path: string;
  operation: ChangeOperation;
  /** Previous path when operation === "rename". */
  previousPath?: string;
  original?: string;
  proposed?: string;
  diff?: string;
  /**
   * Language identifier for the viewer (e.g. "typescript"). Unknown stays
   * undefined — never guessed from content alone.
   */
  language?: string;
}

/** Which side(s) a diff viewer renders. */
export type DiffViewMode = "split" | "inline";

/** A single changed-line hunk reported by the git diff service. */
export interface DiffHunk {
  /** 1-based start line in the ORIGINAL file (0 for pure additions). */
  oldStart: number;
  /** Number of original lines covered (0 for pure additions). */
  oldLines: number;
  /** 1-based start line in the MODIFIED file (0 for pure deletions). */
  newStart: number;
  /** Number of modified lines covered (0 for pure deletions). */
  newLines: number;
}

/** Result of the real git-diff service for one workspace file. */
export interface GitFileDiff {
  path: string;
  branch: string | null;
  headSha: string | null;
  /**
   * True when the file exists in HEAD so an original baseline exists.
   * Untracked files have no baseline — the viewer shows an honest note.
   */
  hasOriginal: boolean;
  /** Real HEAD content (≤ 512 KB text) when hasOriginal, else undefined. */
  original?: string;
  /** Parsed unified-diff hunks (unified=0) for changed-line decorations. */
  hunks: DiffHunk[];
  /** Honest note when the diff could not be produced. */
  note?: string;
}

/** One consecutive run of lines committed together (real git blame). */
export interface BlameRange {
  /** 1-based inclusive start line in the current worktree file. */
  startLine: number;
  /** 1-based inclusive end line. */
  endLine: number;
  /** Commit sha (40 hex). */
  sha: string;
  /** Author name per git blame. */
  author: string;
  /** Author date, ISO 8601 (real, converted from the unix commit time). */
  date: string;
}

/** Result of the real git-blame service for one workspace file. */
export interface GitFileBlame {
  path: string;
  /** Total lines blamed (== real line count of the file). */
  lineCount: number;
  ranges: BlameRange[];
  /** Honest note when part of the file could not be attributed. */
  note?: string;
}
