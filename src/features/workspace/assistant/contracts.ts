/**
 * CodeMind X V2 — Phase 8 AI-assistant INTEGRATION CONTRACT (V2.1 partition).
 *
 * This module is the master typed contract that the Phase 8 sub-phases
 * consume and extend. Per the V2.1 execution partition, parent Phase 8 ships
 * ONLY this contract plus minimal plumbing (see activity-engine.ts) — the
 * dedicated implementations stay with their owning sub-phases:
 *
 *   8A    → Composer UI + Search/Code/Agent/Loop mode controls + attachments
 *   8B    → Activity Engine UI (Lattice loader, Thinking Orb, Thought Chain,
 *           category activity)
 *   8C    → Context Inspector + approval/question UI
 *   8.5   → Response Engine v2 + verified references + rendering pipeline
 *   8.75  → Inline completion + Cmd/Ctrl+K editor edit
 *
 * Every shape here is honest: statuses are real states, payloads carry safe
 * summaries (never chain-of-thought), and anything not yet produced by the
 * backend is absent rather than simulated.
 */

/* ------------------------------------------------------------------ */
/* Versioning                                                          */
/* ------------------------------------------------------------------ */

/** Bumped when a sub-phase extends the contract in a breaking way. */
export const ASSISTANT_CONTRACT_VERSION = "2.1.0-phase8";

/* ------------------------------------------------------------------ */
/* §1 — Run pipeline (the contract, not the executor)                  */
/* ------------------------------------------------------------------ */

/**
 * The assistant pipeline every run conceptually passes through. Sub-phases
 * map their engines onto these stages; the stage ids are stable identifiers
 * for activity reporting and telemetry.
 */
export const PIPELINE_STAGES = [
  "language-detection",
  "intent-understanding",
  "task-classification",
  "repository-retrieval",
  "tool-selection",
  "agent-execution",
  "activity-events",
  "response",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/* ------------------------------------------------------------------ */
/* §10 — Activity model + state machine                                */
/* ------------------------------------------------------------------ */

export type ActivityStatus = "queued" | "active" | "completed" | "failed" | "cancelled";

/** Legal transitions of the activity state machine (§10). */
export const ACTIVITY_TRANSITIONS: Record<ActivityStatus, ActivityStatus[]> = {
  queued: ["active", "cancelled"],
  active: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: ActivityStatus, to: ActivityStatus): boolean {
  return ACTIVITY_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Categories of user-visible activity (§9). A request NEVER shows every
 * category — the category engine selects by what actually ran.
 */
export type ActivityCategory =
  | "steps"
  | "search"
  | "coding"
  | "testing"
  | "security"
  | "git"
  | "architecture";

/**
 * Safe tool summaries — the ONLY tool facts allowed inside activity
 * children. Payloads are execution facts (what ran, on what, outcome),
 * never model reasoning.
 */
export type SafeToolSummary =
  | { tool: "read_file"; path: string; bytes?: number }
  | { tool: "search"; query: string; hits: number }
  | { tool: "run_tests"; target: string; passed: boolean | null; durationMs?: number }
  | { tool: "create_patch"; path: string; approved: boolean };

export interface ActivityNode {
  id: string;
  kind: ActivityCategory | SafeToolSummary["tool"];
  title: string;
  status: ActivityStatus;
  startedAt: number;
  completedAt: number | null;
  /** One-line safe outcome ("14 results", "auth tests passed"). */
  summary: string | null;
  metadata: Record<string, string | number | boolean> | null;
  children: SafeToolSummary[];
}

/** Run-level lifecycle mirror of ActivityStatus. */
export type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

/* ------------------------------------------------------------------ */
/* §11/§12 — Approval + clarifying question payloads (UI in 8C)        */
/* ------------------------------------------------------------------ */

export type ApprovalAction = "review" | "approve" | "reject" | "edit";

export interface ApprovalRequest {
  id: string;
  /** What will change, in plain language. */
  whatWillChange: string;
  /** Affected repository paths. */
  affectedFiles: string[];
  /** Why the run cannot continue without authorization. */
  whyApprovalNeeded: string;
  /** Honest risk statement (e.g. "writes two files", "runs shell command"). */
  risk: string;
  /** The permission being requested. */
  requestedPermission: string;
}

export interface ClarifyQuestionOption {
  id: string;
  label: string;
  /** The value sent back if chosen (e.g. a path). */
  value: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  /** Never silently choose between material implementations — pause and ask. */
  options: ClarifyQuestionOption[];
}

/* ------------------------------------------------------------------ */
/* §2/§3 — Composer contract (UI + controls in 8A)                     */
/* ------------------------------------------------------------------ */

export type ComposerMode = "search" | "code" | "agent" | "loop";

/**
 * Honest default until 8A ships the real mode switcher: today's assistant is
 * general coding-agent assistance.
 */
export const DEFAULT_COMPOSER_MODE: ComposerMode = "agent";

export interface ComposerAttachment {
  id: string;
  kind: "repository-file" | "selection" | "session-file";
  /** Repository-relative path for repository-file attachments. */
  path: string | null;
  /** Display label (basename for files, "selection" chips, etc.). */
  label: string;
  /**
   * Contract: clicking a repository-file attachment opens the ACTUAL file in
   * the repository editor (via EditorNavigationService). Implementation is
   * wired by 8A.
   */
  openableInEditor: boolean;
}

/** Context slots the composer may attach to a run (all optional, all real). */
export interface ComposerContext {
  repository: string | null;
  branch: string | null;
  currentFile: string | null;
  currentSymbol: string | null;
  selectedCode: string | null;
}

export interface ComposerActionHandlers {
  send: (content: string, attachments: ComposerAttachment[]) => void;
  stop: () => void;
  cancel: () => void;
  retry: () => void;
}

/** Model selection stays a CONTRACT SLOT until a real model list exists. */
export interface ComposerModelSlot {
  available: false;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* §4/§8.5 — Response segments (rendering pipeline in 8.5)             */
/* ------------------------------------------------------------------ */

/**
 * Typed response segments. 8.5's rendering pipeline consumes these; today
 * only markdown arrives as a single honest block (no real streaming yet, so
 * no chunk is ever fabricated).
 */
export type ResponseSegment =
  | { kind: "markdown"; text: string }
  | { kind: "code"; language: string; code: string; filePath: string | null }
  | { kind: "fileReference"; path: string; line?: number }
  | { kind: "diff"; path: string; original: string; proposed: string }
  | { kind: "citation"; path: string; lineStart: number; lineEnd: number; quote: string }
  | { kind: "action"; label: string; action: string }
  | { kind: "approval"; approval: ApprovalRequest }
  | { kind: "question"; question: ClarifyQuestion };

/* ------------------------------------------------------------------ */
/* §13 — Streaming events                                              */
/* ------------------------------------------------------------------ */

/**
 * The event vocabulary between the assistant backend and the ActivityEngine.
 * These are PREPARED event types: the current single-shot chat endpoint does
 * not stream, so the engine only receives events that exist truthfully
 * today. Nothing fabricates RESPONSE_CHUNK traffic.
 */
export type AssistantStreamEvent =
  | { type: "RUN_STARTED"; runId: string; conversationId: string | null; startedAt: number; mode: ComposerMode }
  | { type: "ACTIVITY_STARTED"; runId: string; activity: ActivityNode }
  | { type: "ACTIVITY_UPDATED"; runId: string; activityId: string; patch: Partial<Pick<ActivityNode, "title" | "summary" | "metadata">> & { status?: ActivityStatus } }
  | { type: "ACTIVITY_COMPLETED"; runId: string; activityId: string; summary: string | null; completedAt: number }
  | { type: "FILE_REFERENCED"; runId: string; path: string; line: number | null }
  | { type: "SEARCH_RESULT"; runId: string; query: string; hits: number; topFiles: string[] }
  | { type: "APPROVAL_REQUIRED"; runId: string; approval: ApprovalRequest }
  | { type: "QUESTION_REQUIRED"; runId: string; question: ClarifyQuestion }
  | { type: "RESPONSE_CHUNK"; runId: string; segment: ResponseSegment }
  | { type: "RUN_COMPLETED"; runId: string; completedAt: number }
  | { type: "RUN_FAILED"; runId: string; error: string; failedAt: number }
  | { type: "RUN_CANCELLED"; runId: string; cancelledAt: number };
