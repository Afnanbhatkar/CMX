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
export const ASSISTANT_CONTRACT_VERSION = "2.1.0-phase8b";

/* ------------------------------------------------------------------ */
/* §1 — Run pipeline (the contract, not the executor)                  */
/* ------------------------------------------------------------------ */

/**
 * The assistant pipeline every run conceptually passes through. Sub-phases
 * map their engines onto these stages; the stage ids are stable identifiers
 * for activity reporting and telemetry.
 *
 * V2.1 ADDITIONS (memory-aware pipeline) — the stage list was extended
 * additively (no existing id removed or renamed) to carry the updated
 * pipeline: User Request → Language Detection → Intent Understanding →
 * Task Contract (when material) → Memory Retrieval → Repository Retrieval →
 * Context Inspector → Agent/Tool Selection → Execution → Verification →
 * Response.
 */
export const PIPELINE_STAGES = [
  "language-detection",
  "intent-understanding",
  "task-classification",
  "task-contract",
  "memory-retrieval",
  "repository-retrieval",
  "context-inspector",
  "tool-selection",
  "agent-execution",
  "activity-events",
  "verification",
  "response",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/* ------------------------------------------------------------------ */
/* §1.1 (V2.1) — Memory contract                                       */
/* ------------------------------------------------------------------ */

/**
 * Evidence precedence, strongest first. Memory may inform style,
 * conventions and prior decisions but must NEVER override actual
 * repository truth:
 *
 *   current user instruction > actual repository code/evidence >
 *   saved explicit memory > inferred memory
 */
export const MEMORY_PRECEDENCE = [
  "current-user-instruction",
  "repository-evidence",
  "saved-explicit-memory",
  "inferred-memory",
] as const;

export type MemoryPrecedenceTier = (typeof MEMORY_PRECEDENCE)[number];

/** A retrieved memory record (only real retrievals are ever listed). */
export interface MemoryRecord {
  id: string;
  tier: Extract<MemoryPrecedenceTier, "saved-explicit-memory" | "inferred-memory">;
  /** Privacy-safe content actually handed to the run (no secrets). */
  content: string;
  /** Where it came from (worklog, phase docs, user-saved note, …). */
  source: string;
}

/** Outcome of the memory-retrieval stage for ONE run. */
export interface MemoryRetrievalOutcome {
  retrieved: MemoryRecord[];
  /** Whether any memory actually informed the response. */
  applied: boolean;
  /** Why nothing was applied ("no memory store connected", …). */
  note: string | null;
}

/* ------------------------------------------------------------------ */
/* §1.2 (V2.1) — Task contract (when material)                         */
/* ------------------------------------------------------------------ */

/**
 * The material understanding of a request, produced by the task-contract
 * stage only when the request is substantial enough to warrant one.
 */
export interface TaskContract {
  /** Short imperative title ("Add retry to importer"). */
  title: string;
  /** What success looks like, in plain language. */
  goal: string;
  /** Real constraints (files, compat, perf, style). */
  constraints: string[];
  /** The concrete deliverable ("patch + tests", "explanation", …). */
  deliverable: string;
}

/* ------------------------------------------------------------------ */
/* §1.3 (V2.1) — Uncertainty vocabulary (evidence-backed)              */
/* ------------------------------------------------------------------ */

/**
 * Visible uncertainty labels the response system supports. Every label
 * MUST be evidence-backed: "confirmed"/"likely" carry evidence references,
 * "potential" states the assumption, "unknown" states what is missing.
 */
export const UNCERTAINTY_LEVELS = [
  "confirmed",
  "likely",
  "potential",
  "unknown",
] as const;

export type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number];

export interface EvidenceBackedClaim {
  statement: string;
  uncertainty: UncertaintyLevel;
  /** Real evidence ref (repo path:line, tool output) — null ONLY for "unknown". */
  evidence: string | null;
}

/* ------------------------------------------------------------------ */
/* §1.4 (V2.1) — Intake question batching                              */
/* ------------------------------------------------------------------ */

/**
 * When multiple material decisions are needed before execution, they are
 * asked ONCE as a batch at the start of the run — never as repeated tiny
 * interruptions. (Batch UI consumes this in 8C.)
 */
export interface IntakeQuestionBatch {
  id: string;
  questions: ClarifyQuestion[];
  /** Why these decisions are material (one line). */
  rationale: string | null;
  askedAt: number;
}

/* ------------------------------------------------------------------ */
/* §1.5 (V2.1) — Context Inspector snapshot (UI in 8C)                 */
/* ------------------------------------------------------------------ */

/** Where one selected-context item came from. */
export type ContextInspectorSource =
  | "repository"
  | "branch"
  | "current-file"
  | "selected-code"
  | "attachment"
  | "memory"
  | "search";

/** One selected-context entry, exactly as the run received it. */
export interface ContextInspectorEntry {
  source: ContextInspectorSource;
  /** Stable ref: path, "repo:name", "branch:x", "selection:path:L-L", … */
  ref: string;
  /** Included in the actual request payload — never a planned-only item. */
  included: boolean;
  /** Why it was selected/excluded (one line). */
  reason: string;
}

/** What the future Context Inspector (8C) renders for a run. */
export interface ContextInspectorSnapshot {
  runId: string;
  entries: ContextInspectorEntry[];
  capturedAt: number;
}

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
  | "architecture"
  | "deployment";

/** Display metadata for one activity category (category engine, Phase 8B). */
export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  steps: "Steps",
  search: "Search",
  coding: "Coding",
  testing: "Testing",
  security: "Security",
  git: "Git",
  architecture: "Architecture",
  deployment: "Deployment",
};

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

/**
 * Model descriptor served BY the LLM Gateway (never by a provider SDK in
 * UI code). Availability/labels come from the gateway's real catalog.
 */
export interface GatewayModelDescriptor {
  /** Opaque model id as the gateway routes it. */
  id: string;
  /** Human label for the picker. */
  label: string;
  /** Whether the gateway can actually route this model today. */
  available: boolean;
  /** The model the transport ACTUALLY serves for this id, when measured. */
  servedModel: string | null;
  /** Honest note (e.g. transport normalizes ids to one served model). */
  note: string | null;
}

/**
 * Model selection resolves through the LLM Gateway catalog. When the
 * gateway cannot serve a catalog, `available: false` carries the reason.
 */
export interface ComposerModelSlot {
  available: boolean;
  reason: string | null;
  models: GatewayModelDescriptor[];
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
  | { type: "INTAKE_QUESTIONS_REQUIRED"; runId: string; batch: IntakeQuestionBatch }
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

/* ------------------------------------------------------------------ */
/* §13.1 (8B) — Sequenced wire events                                  */
/* ------------------------------------------------------------------ */

/**
 * Wire shape of every event emitted by the streaming run surface
 * (POST /api/assistant/runs, Phase 8B): the contract event PLUS a
 * monotonic per-run `seq` starting at 1. Every event carries a sequence
 * number — consumers may rely on ordering and detect gaps defensively.
 */
export type SequencedAssistantEvent = AssistantStreamEvent & { seq: number };

/** The safe execution summaries allowed as activity titles (8B §1). */
export const SAFE_ACTIVITY_SUMMARIES = [
  "Understanding request",
  "Searching repository",
  "Reading files",
  "Checking dependencies",
  "Planning implementation",
  "Writing patch",
  "Running tests",
  "Checking security",
  "Preparing preview",
  "Composing response",
] as const;

export type SafeActivitySummary = (typeof SAFE_ACTIVITY_SUMMARIES)[number];
