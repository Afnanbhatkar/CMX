/**
 * CodeMind X V2 — Phase 2 workspace contracts.
 *
 * Shared vocabulary for the four-panel AI software engineering workspace.
 * These are typed contracts only. No component behavior lives here.
 *
 * Honesty rules carried by these types (RULES.md §9):
 * - Values that do not exist yet must be `null` / `"planned"` / `"unavailable"`,
 *   never fabricated.
 * - Persisted layout data must never contain credentials, tokens or secrets.
 */

import type { ActivityKind } from "@/types/contracts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ContextInspectorSnapshot,
  IntakeAnswer,
  IntakeQuestionBatch,
  MemoryRecord,
} from "@/features/workspace/assistant/contracts";

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Versioned persistence schema (spec §31). Bump when the shape changes.
 *
 * v2 — assistant-scoped chrome + exact rail collapse.
 * v3 — FIXED sidebar widths (user directive, V2.1 addition §F): the CodeMind
 *      X sidebar and the AI Chat Sidebar are locked at exactly 11% and are
 *      NO LONGER user-adjustable. Only the chat|repo split remains
 *      draggable. Persisted v2 layouts reset to 11% | 11% | 39% | 39%.
 *      Conversations are preserved.
 * v4 — ADJUSTABLE sidebar widths (user directive, Phase 4 session): the two
 *      sidebars may grow from their 11% default up to a MAXIMUM of 15%
 *      (never below 11%). Persisted v3 layouts reset to the canonical
 *      11% | 11% | 39% | 39%; conversations remain preserved. The explorer
 *      open/closed (focus) state is also part of the persisted layout.
 * v5 — adds persisted `intelligenceOpen` (file-intelligence panel). Persisted
 *      v4 layouts reset to the canonical panel defaults; conversations, tabs
 *      and section are preserved via the migrate→merge bridge (spec §31).
 */
export const WORKSPACE_LAYOUT_VERSION = 5;

/** Default desktop composition: 11% | 11% | 39% | 39%. */
export const PANEL_DEFAULTS = {
  cmx: 11,
  chatSidebar: 11,
  chat: 39,
  repo: 39,
} as const;

/**
 * Panel size boundaries (percent of workspace width).
 *
 * Sidebar panels default to 11% and are user-adjustable ONLY upward —
 * between 11% (min) and 15% (max) per the Phase 4 session directive
 * ("increase karne ka, 11% se neeche nhi, max 15%"). The collapse toggle
 * remains the only other width change (11–15% ⇄ exact 48px rail). The
 * chat|repo split remains user-adjustable and always absorbs the remainder.
 */
export const PANEL_LIMITS = {
  cmx: { min: 11, max: 15 },
  chatSidebar: { min: 11, max: 15 },
  chat: { min: 20, max: 60 },
  repo: { min: 20, max: 60 },
} as const;

/** Width (px) of a collapsed icon rail. */
export const RAIL_PX = 48;

export interface PanelSizes {
  cmx: number;
  chatSidebar: number;
  chat: number;
  repo: number;
}

export interface PanelCollapseState {
  cmx: boolean;
  chatSidebar: boolean;
}

/* ------------------------------------------------------------------ */
/* CodeMind X sidebar destinations                                     */
/* ------------------------------------------------------------------ */

export type WorkspaceSectionId =
  | "overview"
  | "assistant"
  | "repository"
  | "search"
  | "architecture"
  | "security"
  | "testing"
  | "documentation"
  | "change-impact"
  | "git"
  | "health"
  | "evaluation"
  | "settings";

export type DestinationAvailability = "available" | "planned";

export interface DestinationMeta {
  id: WorkspaceSectionId;
  label: string;
  /** Reflects the REAL capability registry — `planned` never renders a fake UI. */
  availability: DestinationAvailability;
  /** Honest note for planned destinations ("… arrives in a later phase"). */
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Conversations & messages                                            */
/* ------------------------------------------------------------------ */

export type ConversationStatus =
  | "active"
  | "generating"
  | "stopped"
  | "completed"
  | "error";

export type MessageState = "complete" | "generating" | "error" | "stopped";

export interface Attachment {
  id: string;
  kind: "file" | "selection" | "repository" | "tool-result";
  label: string;
  /** Real workspace-relative path when the attachment points at a file. */
  path?: string;
}

/**
 * Privacy-safe activity step (ARCHITECTURE.md §8). Structurally identical to
 * `ThoughtStep` from the reference activity components, declared here so the
 * store never depends on component modules.
 *
 * Phase 8B: steps can carry a one-line safe outcome and safe execution-fact
 * children (Odyssey progressive disclosure) — never model reasoning.
 */
export interface ChatActivityStepChild {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export interface ChatActivityStep {
  id: string;
  kind: ActivityKind;
  /** Short system-activity message — never private model reasoning. */
  label: string;
  status: "pending" | "active" | "done" | "error";
  /** One-line safe outcome ("14 relevant results"). */
  detail?: string | null;
  /** Safe tool-summary children (execution facts only). */
  children?: ChatActivityStepChild[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  state: MessageState;
  /** Present when state === "error". Honest failure message. */
  error?: string;
  attachments?: Attachment[];
  /** User-visible execution summary for the activity region. */
  activity?: ChatActivityStep[];
  /** Composer mode the run was issued with (Phase 8A; assistant messages). */
  mode?: "search" | "code" | "agent" | "loop";
  /** The model the gateway ACTUALLY served for this message (measured). */
  servedModel?: string | null;
  /** Client-measured ms from send to the first visible activity event (8B). */
  firstEventMs?: number | null;
  /** Engine-measured total run duration behind "Thought for Xs" (8B). */
  thoughtForMs?: number | null;
  /* ---- 8C additions — context inspector / memory / questions / approval ---- */
  /** The backend run id this message belongs to (question-flow addressing). */
  runId?: string | null;
  /** Measured truth of what the run actually received (CONTEXT_SNAPSHOT). */
  contextSnapshot?: ContextInspectorSnapshot | null;
  /** Real retrieved memory records shown by the "Memory used: N" chip. */
  memories?: MemoryRecord[];
  /** Honest note when no memory applied. */
  memoryNote?: string | null;
  /** The intake question batch the run paused on (8C question flow). */
  questionBatch?: IntakeQuestionBatch | null;
  /** The answers the user gave (persisted once the run resumed). */
  intakeAnswers?: IntakeAnswer[];
  /** Approval request parsed from the model's proposal (APPROVAL_REQUIRED). */
  approval?: ApprovalRequest | null;
  /** The recorded human decision on the approval card (never auto-applied). */
  approvalDecision?: ApprovalDecision | null;
}

export interface Conversation {
  id: string;
  /** Derived from the first user message; `null` until then (never fabricated). */
  title: string | null;
  createdAt: string;
  updatedAt: string;
  status: ConversationStatus;
  pinned: boolean;
  archived: boolean;
  messages: ChatMessage[];
}

/* ------------------------------------------------------------------ */
/* AI run (Current AI Run surface)                                     */
/* ------------------------------------------------------------------ */

/**
 * Full run-phase vocabulary is the UI contract for later execution systems
 * (spec §13). Phase 2 only ever sets: idle | thinking | failed.
 */
export type AIRunPhase =
  | "idle"
  | "thinking"
  | "searching"
  | "reading"
  | "planning"
  | "coding"
  | "testing"
  | "reviewing"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "cancelled";

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface RepoTreeNode {
  path: string;
  name: string;
  type: "file" | "dir";
  children?: RepoTreeNode[];
  /** Phase 5 — informational language hint (e.g. "typescript"); omitted when unknown. */
  language?: string;
  /** Phase 5 — true when the file content was cut off by a read limit. */
  truncated?: boolean;
}

export interface RepoMeta {
  repository: {
    /** true — this is the local workspace repository itself. */
    connected: boolean;
    name: string;
    /** Real branch from git, or null when unavailable. */
    branch: string | null;
  };
  indexing: { status: "unavailable"; note: string };
}

export interface RepoFile {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
  /**
   * V2.1 §A/§E — the file loaded through the large-file path (> 512 KB).
   * The editor sheds expensive features (minimap, folding) for these.
   */
  largeFile?: boolean;
}

export type OpenTabStatus =
  | "loading"
  | "ready"
  | "error"
  | "binary"
  | "too-large"
  | "missing";

export interface OpenTab {
  path: string;
  /** Transient — stripped before persistence. */
  content?: string;
  status?: OpenTabStatus;
  error?: string;
  /**
   * Phase 5 — working-tree status (git status --porcelain). Null = clean or
   * unknown. Session-only/derived: never persisted, arrives via a separate
   * status map (applyGitStatus), never embedded in the tree.
   */
  gitStatus?: TreeGitStatus | null;
  /**
   * Phase 6 — true for GENERATED scratch tabs (AI code blocks opened without
   * a repository file reference). These tabs never fetch from disk and are
   * always clearly badged "generated". Session-only: never persisted.
   */
  generated?: boolean;
  /** Phase 6 — editor language id for generated tabs (e.g. "typescript"). */
  generatedLanguage?: string;
  /**
   * Phase 6 — in-memory buffer differs from the loaded file content.
   * Session-only, per path; honest "unsaved (in-memory)" indicator, no fake
   * save flow (file writes arrive in a later phase).
   */
  dirty?: boolean;
}

/* ------------------------------------------------------------------ */
/* Shared file state (V2.1 ADDITIONS §C)                               */
/* ------------------------------------------------------------------ */

/**
 * The ONE shared file-state vocabulary for every surface that renders a
 * repository file (tree, tabs, chips, search, approvals, timelines…).
 * Values beyond the working-tree `TreeGitStatus` set are stateful client or
 * access-control states that a backend confirms — never inferred client-side.
 */
export type SharedFileState =
  | "clean"
  | "modified"
  | "staged"
  | "added"
  | "deleted"
  | "conflicted"
  | "locked"
  | "read-only";

/**
 * Presentation metadata for SharedFileState. Colors are applied by the
 * rendering component (this file holds no JSX); labels are honest and
 * short. `note` explains what the state means when it is not a plain
 * working-tree status.
 */
export const FILE_STATE_META: Record<
  SharedFileState,
  { label: string; note?: string }
> = {
  clean: { label: "Clean" },
  modified: { label: "Modified" },
  staged: { label: "Staged", note: "Staged for commit (git index)." },
  added: { label: "Added" },
  deleted: { label: "Deleted" },
  conflicted: {
    label: "Conflicted",
    note: "Merge/rebase conflict markers detected.",
  },
  locked: {
    label: "Locked",
    note: "Another process or agent holds an exclusive lock.",
  },
  "read-only": {
    label: "Read-only",
    note: "Writing to this file is disabled by policy or permissions.",
  },
};

/* ------------------------------------------------------------------ */
/* Selected-code AI actions (Phase 6 §5)                               */
/* ------------------------------------------------------------------ */

/** Vocabulary of the editor selection AI actions — each becomes AI context. */
export type SelectionAIAction =
  | "explain"
  | "review"
  | "fix"
  | "refactor"
  | "optimize"
  | "tests"
  | "docs"
  | "security"
  | "ask";

/** Prompt preamble per action (the selected code is appended after it). */
export const SELECTION_ACTION_PROMPTS: Record<
  SelectionAIAction,
  { label: string; prompt: string }
> = {
  explain: { label: "Explain", prompt: "Explain what this code does, step by step." },
  review: { label: "Review", prompt: "Review this code and list concrete issues and improvements." },
  fix: { label: "Fix", prompt: "Find the problems in this code and propose a corrected version." },
  refactor: { label: "Refactor", prompt: "Refactor this code for clarity and maintainability. Show the refactored version." },
  optimize: { label: "Optimize", prompt: "Optimize this code for performance. Explain the changes." },
  tests: { label: "Generate Tests", prompt: "Generate focused unit tests for this code." },
  docs: { label: "Generate Documentation", prompt: "Write clear documentation comments for this code." },
  security: { label: "Security Review", prompt: "Perform a security review of this code. List vulnerabilities with severity." },
  ask: { label: "Ask AI", prompt: "" },
};

/**
 * A selection of real file content shared between the editor, the AI
 * composer and the navigation service. `code` is the exact text selected.
 */
export interface FileSelection {
  path: string;
  startLine: number;
  endLine: number;
  language: string | null;
  code: string;
}

/* ------------------------------------------------------------------ */
/* File provenance & intelligence metadata (Phase 5)                   */
/* ------------------------------------------------------------------ */

/** Working-tree status for a path (git status --porcelain mapping). */
export type TreeGitStatus =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed";

/**
 * Security-oriented, informational content classification (V2.1 §A).
 * Null = ordinary source, unclassified.
 */
export type ContentClassification =
  | "repository_data"
  | "repository_documentation"
  | "repository_comment"
  | "repository_fixture"
  | "repository_generated_output";

/**
 * Provenance + status metadata for a file (V2.1 §B/§D).
 * All fields honest — null when the value is unknown, never fabricated.
 */
export interface FileProvenanceMeta {
  path: string;
  language: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  mimeType: string | null;
  gitStatus: TreeGitStatus | null;
  branch: string | null;
  commitSha: string | null;
  lastModifiedAt: string | null;
  classification: ContentClassification | null;
}

/** One commit in a file's history (real `git log --follow`). */
export interface FileHistoryCommit {
  sha: string;
  author: string;
  date: string; // ISO
  message: string;
}

/* ------------------------------------------------------------------ */
/* Editor navigation contract (spec §28)                               */
/* ------------------------------------------------------------------ */

export type EditorNavigationSource =
  | "chat"
  | "search"
  | "architecture"
  | "security"
  | "testing"
  | "git"
  | "terminal"
  | "palette"
  | "intelligence"
  | "manual";

/**
 * The single typed payload every file-opening feature must use.
 * All fields except `filePath` are optional.
 */
export interface EditorNavigationPayload {
  repositoryId?: string;
  filePath: string;
  line?: number;
  column?: number;
  range?: {
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
  symbol?: string;
  sourceContext?: EditorNavigationSource;
  navigationReason?: string;
}

export type EditorNavigationResult =
  | { ok: true; filePath: string; line?: number }
  | {
      ok: false;
      code:
        | "empty-path"
        | "not-found"
        | "load-failed"
        | "binary"
        | "too-large";
      message: string;
    };

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

export interface WorkspaceCommand {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  /** Disabled commands render with their honest reason and cannot run (spec §34). */
  enabled: boolean;
  disabledReason?: string;
  run: () => void;
}

/* ------------------------------------------------------------------ */
/* AI workspace context (typed contract — values stay honest)          */
/* ------------------------------------------------------------------ */

export interface AIWorkspaceContextSnapshot {
  repository: string | null;
  branch: string | null;
  activeFile: string | null;
  /** Phase 2 has no selection tracking — always null, never fabricated. */
  selectedCode: string | null;
  attachments: Attachment[];
}
