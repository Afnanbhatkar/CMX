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
 */
export const WORKSPACE_LAYOUT_VERSION = 3;

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
 * Sidebar panels are FIXED at exactly 11% (min === max) per the V2.1
 * canonical-shell directive: the user cannot resize them; the collapse
 * toggle is the only width change (11% ⇄ exact 48px rail). The chat|repo
 * split remains user-adjustable and always absorbs the remaining 78%.
 */
export const PANEL_LIMITS = {
  cmx: { min: 11, max: 11 },
  chatSidebar: { min: 11, max: 11 },
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
 */
export interface ChatActivityStep {
  id: string;
  kind: ActivityKind;
  /** Short system-activity message — never private model reasoning. */
  label: string;
  status: "pending" | "active" | "done" | "error";
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
