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
export const ASSISTANT_CONTRACT_VERSION = "2.1.0-phase8.5";

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

/** Honest confidence for a memory record (derived from real match strength). */
export type MemoryConfidence = "high" | "medium" | "low";

/** A retrieved memory record (only real retrievals are ever listed). */
export interface MemoryRecord {
  id: string;
  tier: Extract<MemoryPrecedenceTier, "saved-explicit-memory" | "inferred-memory">;
  /** Privacy-safe content actually handed to the run (no secrets). */
  content: string;
  /** Where it came from (worklog, phase docs, user-saved note, …). */
  source: string;
  /* ---- 8C additions (memory reveal UI) — additive, never breaks 8A consumers ---- */
  /** What the memory is scoped to (task id, phase, conversation). */
  scope: string | null;
  /** Confidence derived from the REAL match strength (term hits), never a percentage. */
  confidence: MemoryConfidence;
  /** Real evidence pointer ("worklog.md#task-8b", "CHANGELOG.md#phase-7"). */
  evidence: string | null;
  /** The query terms that actually matched (the retrieval reason). */
  matchedTerms: string[];
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

/** One answer to one intake question (8C question flow). */
export interface IntakeAnswer {
  questionId: string;
  /** Chosen option id — null when a custom answer was typed. */
  optionId: string | null;
  /** Custom free-text answer — null when an option was chosen. */
  customText: string | null;
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
  | "search"
  /** 8C: a file the user pinned in the Context Inspector (included every run). */
  | "pinned";

/** One included chunk of one context entry (8C — the real slice that was sent). */
export interface ContextChunk {
  /** Chunk ref, e.g. "src/auth/session.ts · chars 0–6000". */
  ref: string;
  included: boolean;
  /** Why this chunk was (or was not) sent ("full file", "first 6000 of 12000 chars"). */
  reason: string;
}

/** One selected-context entry, exactly as the run received it. */
export interface ContextInspectorEntry {
  source: ContextInspectorSource;
  /** Stable ref: path, "repo:name", "branch:x", "selection:path:L-L", … */
  ref: string;
  /** Included in the actual request payload — never a planned-only item. */
  included: boolean;
  /** Why it was selected/excluded (one line). */
  reason: string;
  /* ---- 8C additions — additive ---- */
  /** Display label (basename or short form of the ref). */
  label: string;
  /** Real character count of what this entry contributed to the payload. */
  charCount: number;
  /** Honest token estimate (chars ÷ 4) — always labeled as an estimate. */
  tokenEstimate: number;
  /** The real chunk(s) that were (or were not) sent for this entry. */
  chunks: ContextChunk[];
  /** Real symbols associated with the entry (search symbol hits; empty when unknown). */
  symbols: string[];
}

/**
 * What the Context Inspector (8C) renders for a run: the measured truth of
 * what the request actually carried.
 */
export interface ContextInspectorSnapshot {
  runId: string;
  entries: ContextInspectorEntry[];
  capturedAt: number;
  /* ---- 8C additions — additive ---- */
  /** Sum of included entry character counts (real). */
  charCountTotal: number;
  /** Honest token estimate for the whole payload (chars ÷ 4). */
  tokenEstimateTotal: number;
  /** The configured context envelope of this pipeline (chars). */
  budgetChars: number;
  /** budgetChars ÷ 4 — displayed next to the estimate, always labeled as estimate. */
  budgetTokensEstimate: number;
  /** How many memory records were retrieved and applied (0 when none). */
  memoryCount: number;
  /** Honest memory note when nothing applied ("no memory matched", …). */
  memoryNote: string | null;
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

/**
 * Run-level lifecycle mirror of ActivityStatus.
 * 8C adds "awaiting-answers": the run is paused because the assistant asked
 * material intake questions; it resumes ONLY after the user answers.
 */
export type RunStatus =
  | "idle"
  | "running"
  | "awaiting-answers"
  | "completed"
  | "failed"
  | "cancelled";

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
  /* ---- 8C additions — additive ---- */
  /** Tests the proposal expects to satisfy (model-provided; may be empty). */
  expectedTests: string[];
  /** Honest security impact statement (model-provided; may be empty). */
  securityImpact: string;
  /* ---- Phase 9.6 — additive ---- */
  /** Present when this approval belongs to a REAL orchestrator run: the
   *  decision must be delivered to the orchestrator's approval gate (the
   *  run is paused at the engine gate until a human decides). */
  orchestratorRunId?: string;
  /* ---- Agent Mode V2 — additive (spec §50) ---- */
  /** Per-file operations behind this approval (real ChangeSet contents). */
  changes?: { path: string; changeKind: "add" | "modify" | "delete"; reason: string }[];
  /** Machine-countable blast radius (spec §20). */
  counts?: { created: number; modified: number; deleted: number };
  /** The change-set this approval applies (idempotency + audit). */
  changeSetId?: string;
}

/** The decision a human made on an approval card (8C — recorded, never applied). */
export type ApprovalDecision = "approved" | "rejected" | "edited";

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
/* §13.2 — Agent Mode V2: real change result (spec §21/§22/§81/§82)      */
/* ------------------------------------------------------------------ */

/** One real file mutation outcome (machine-generated — never summarized by a model). */
export interface ChangeResultFile {
  path: string;
  verified: boolean;
}

/** One honest validation check ("skipped" is reported as skipped, never passed). */
export interface ChangeValidationCheck {
  name: string;
  path: string;
  status: "passed" | "failed" | "skipped";
  detail: string | null;
}

/** One unified-diff line computed from REAL before/after disk content. */
export interface ChangeDiffLine {
  kind: "add" | "remove" | "same";
  text: string;
}

export interface ChangeResultDiffEntry {
  path: string;
  operation: "create" | "modify" | "delete";
  lines: ChangeDiffLine[] | null;
}

/** The typed result the chat renders after a real mutation (spec §22). */
export interface ChangeResultSummary {
  changeSetId: string | null;
  created: ChangeResultFile[];
  modified: ChangeResultFile[];
  deleted: ChangeResultFile[];
  validation: ChangeValidationCheck[];
  noOp: boolean;
  conflict: string | null;
  error: string | null;
  /** Real diffs (bounded) for the View-diff control. */
  diffs?: ChangeResultDiffEntry[] | null;
}

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
  | { type: "CONTEXT_SNAPSHOT"; runId: string; snapshot: ContextInspectorSnapshot }
  | { type: "MEMORY_USED"; runId: string; memories: MemoryRecord[]; note: string | null }
  | { type: "ACTIVITY_STARTED"; runId: string; activity: ActivityNode }
  | { type: "ACTIVITY_UPDATED"; runId: string; activityId: string; patch: Partial<Pick<ActivityNode, "title" | "summary" | "metadata">> & { status?: ActivityStatus } }
  | { type: "ACTIVITY_COMPLETED"; runId: string; activityId: string; summary: string | null; completedAt: number }
  | { type: "FILE_REFERENCED"; runId: string; path: string; line: number | null }
  | { type: "SEARCH_RESULT"; runId: string; query: string; hits: number; topFiles: string[] }
  | { type: "APPROVAL_REQUIRED"; runId: string; approval: ApprovalRequest }
  | { type: "QUESTION_REQUIRED"; runId: string; question: ClarifyQuestion }
  | { type: "RESPONSE_CHUNK"; runId: string; segment: ResponseSegment }
  | { type: "RESPONSE_STRUCTURED"; runId: string; structured: StructuredResponse }
  | { type: "RUN_COMPLETED"; runId: string; completedAt: number }
  | { type: "RUN_FAILED"; runId: string; error: string; failedAt: number }
  | { type: "RUN_CANCELLED"; runId: string; cancelledAt: number }
  /* ---- Agent Mode V2 additions (spec §5/§31/§51/§56/§110) ---- */
  /** The run PAUSED server-side (approval gate / intake questions). The
   *  phase-1 stream ENDS after this frame; the client resumes through
   *  POST /api/assistant/runs/resume — the same run, the same seq space. */
  | { type: "RUN_PAUSED"; runId: string; reason: "approval" | "answers"; approvalId?: string; orchestratorRunId?: string }
  /** The human decision landed — the waiting_approval row completes with
   *  the honest mark and the run continues (apply/verify/validate). */
  | { type: "APPROVAL_DECIDED"; runId: string; approvalId: string; decision: "approved" | "rejected" }
  /** Machine-generated result of the REAL mutation (the chat result card). */
  | { type: "CHANGE_RESULT"; runId: string; result: ChangeResultSummary };

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

/* ------------------------------------------------------------------ */
/* §14 (8C) — Context Inspector budget constants                       */
/* ------------------------------------------------------------------ */

/**
 * The configured context envelope of THIS pipeline (server + client agree).
 * It is a real, enforced design budget for the assembled request — not a
 * transport limit. Token numbers are always derived as chars ÷ 4 and always
 * labeled "estimate" (no tokenizer is connected in this build).
 */
export const CONTEXT_BUDGET_CHARS = 96_000;
export const CONTEXT_BUDGET_TOKENS_ESTIMATE = Math.floor(CONTEXT_BUDGET_CHARS / 4);

/**
 * The marker fence the model must emit (code/agent mode only) when its plan
 * would modify repository files. The backend parses this block, strips it
 * from the displayed answer, and emits APPROVAL_REQUIRED. If the model never
 * emits it, no approval card appears — nothing is fabricated.
 */
export const APPROVAL_MARKER = "codemind-approval-request";

/* ------------------------------------------------------------------ */
/* §15 (8.5) — Structured response + verified references               */
/* ------------------------------------------------------------------ */

/**
 * Response templates (8.5 §5). The template drives the UI section flow —
 * the UI never infers structure by parsing the markdown body.
 */
export const RESPONSE_TEMPLATES = [
  "explain",
  "debug",
  "review",
  "architecture",
  "general",
] as const;

export type ResponseTemplate = (typeof RESPONSE_TEMPLATES)[number];

/** One file/reference VERIFIED against repository intelligence (8.5 §3). */
export interface StructuredReference {
  /** The raw reference as the model produced it ("src/x.ts", "src/x.ts:12-20"). */
  raw: string;
  /** The path part (line stripped, whitespace trimmed). */
  path: string;
  line: number | null;
  lineEnd: number | null;
  /**
   * verified = the path EXISTS in the real workspace AND the line range
   * (when given) is within the file. Anything else is "unknown" — the UI
   * shows plain text / an Unknown Reference badge and never a clickable link.
   */
  status: "verified" | "unknown";
  /** Real line count of the file when the path exists (verifier evidence). */
  lineCount: number | null;
  /** Honest verifier note ("no such file in the workspace index", …). */
  note: string | null;
}

/** One symbol VERIFIED against the real symbol table (8.5 §3). */
export interface StructuredSymbol {
  name: string;
  status: "verified" | "unknown";
  /** The real definition site when verified. */
  path: string | null;
  line: number | null;
  /** The real construct kind (function/class/…). */
  kind: string | null;
}

/** One code block with verified metadata (8.5 §6). The code TEXT itself
 * always comes from the draft's own fenced blocks — never duplicated here. */
export interface StructuredCodeBlock {
  language: string;
  /** Model-provided filename, when it named one. */
  filename: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  /** generated = model-authored; modified = presented as a change to an existing file. */
  status: "generated" | "modified";
  /** 1-based lines (of the referenced real file) to highlight. */
  highlightLines: number[];
  /** Whether the filename resolved in the real workspace. */
  fileStatus: "verified" | "unknown";
}

/** An action the UI may offer on the response (labels are model-provided). */
export interface StructuredAction {
  label: string;
  action: string;
}

/**
 * The typed structured response (8.5 §2). Produced by the response pipeline
 * (draft → structured output → reference verifier → critic → refine) and
 * consumed by the rendering pipeline. The UI NEVER parses the markdown body
 * to determine application state — everything below is typed data.
 */
export interface StructuredResponse {
  version: "8.5";
  runId: string;
  template: ResponseTemplate;
  summary: string | null;
  claims: EvidenceBackedClaim[];
  files: StructuredReference[];
  symbols: StructuredSymbol[];
  /** Metadata for the draft's fenced code blocks, IN ORDER (may be shorter). */
  code: StructuredCodeBlock[];
  actions: StructuredAction[];
  sources: StructuredReference[];
  /** Overall uncertainty of THIS response, with the honest reason. */
  uncertainty: { level: UncertaintyLevel; reason: string | null };
  followups: string[];
  /** The real memory records this run used (echoes the MEMORY_USED event). */
  memoryUsed: { id: string; label: string; source: string }[];
  verification: {
    verifiedCount: number;
    unknownCount: number;
    /** Rule-based critic findings — real checks, human-readable. */
    criticNotes: string[];
    verifiedAt: number;
    /** How this payload was produced ("llm-structured+rule-critic" | …). */
    via: string;
    /** Honest note when the structured LLM output was unusable. */
    note: string | null;
  };
}

/** Gateway capabilities as MEASURED by the transport (8.5 §9 — honest). */
export interface AssistantCapabilities {
  transport: string;
  imageUnderstanding: { supported: boolean; reason: string | null };
  diagramRendering: { supported: boolean; renderer: string | null };
}
