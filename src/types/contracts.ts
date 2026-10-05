/**
 * CodeMind X V2 — Infrastructure Contracts (Phase 0)
 *
 * These are SHARED TYPE CONTRACTS only. They define the vocabulary that later
 * phases will implement against. Deliberately contains NO runtime behavior,
 * NO fake implementations, and NO hidden state.
 *
 * Ownership:
 * - PhaseStatus / PhaseInfo   → phase tracking surfaces
 * - AgentStatus               → agent orchestration (planned phases)
 * - ActivityKind / ActivityEvent → user-visible execution activity
 *
 * Privacy rule (ARCHITECTURE.md §8): activity events describe WHAT THE SYSTEM
 * IS DOING. They must never carry private model chain-of-thought, private
 * deliberation tokens, or secret prompts.
 */

/** Lifecycle of a build-out phase. */
export type PhaseStatus = "planned" | "active" | "completed" | "failed";

/** Lifecycle of an orchestrated agent. */
export type AgentStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed";

/**
 * Closed vocabulary of user-visible execution activity kinds.
 * UI activity streams must render only these categories plus a human-readable
 * label/message — never private model reasoning.
 */
export type ActivityKind =
  | "understanding"
  | "search"
  | "read"
  | "plan"
  | "code"
  | "test"
  | "security"
  | "git"
  | "architecture"
  | "finalize"
  | "deployment";

/** Metadata describing a build-out phase (for status surfaces). */
export interface PhaseInfo {
  /** Stable phase identifier, e.g. "0", "0.5", "1", "8A". */
  id: string;
  title: string;
  status: PhaseStatus;
}

/**
 * A single user-visible activity item.
 *
 * Invariants for future implementations:
 * - `message` is a system-activity statement ("Searching repository…"),
 *   not model reasoning.
 * - `kind` MUST be one of the ActivityKind values.
 */
export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** Human-readable, privacy-safe description of the system action. */
  message: string;
  createdAt: string; // ISO 8601 timestamp
  /** Optional completion timestamp once the step finishes. */
  finishedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Real-time activity chain — VIEW/ADAPTER types (Phase 8D)            */
/*                                                                     */
/* These are the view-model types for the real-time AI activity chain. */
/* They are deliberately SEPARATE from the wire contracts owned by the  */
/* assistant subsystem (features/workspace/assistant/contracts.ts):    */
/* the adapter maps existing Phase-8 sequenced events onto these view  */
/* types. Nothing here replaces or redefines a server/event type.      */
/* ------------------------------------------------------------------ */

/** High-level phase of one run's activity chain (deterministic machine). */
export type ActivityPhase =
  | "thinking"
  | "solving"
  | "waiting"
  | "complete"
  | "failed"
  | "cancelled";

/** Per-row render status of one activity row. */
export type ActivityRowStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting";

/**
 * Controlled activity kinds for the chain view. Titles are always rendered
 * from fixed templates keyed by these kinds — never from model free text.
 * There is deliberately NO "reasoning" kind.
 */
export type ActivityViewKind =
  | "understand"
  | "analysis"
  | "plan"
  | "web_search"
  | "repo_search"
  | "read_file"
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "rename_file"
  | "run_command"
  | "run_tests"
  | "verify"
  | "verify_response"
  | "prepare"
  | "tool"
  | "waiting_approval"
  | "waiting_question"
  | "error";

/** One real file/reference fact under an activity row (safe metadata only). */
export interface ActivityViewChild {
  id: string;
  /** Rendered label (already redacted/capped by the adapter). */
  label: string;
  /** Repository-relative path when this child is navigable. */
  path: string | null;
  line: number | null;
}

/** One renderable row of the activity timeline (possibly a merged group). */
export interface ActivityViewRow {
  /** Stable identity — the first underlying event's id (never an index). */
  id: string;
  kind: ActivityViewKind;
  /** Fixed template title (adapter-controlled, never model free text). */
  title: string;
  /** Safe detail line (redacted + length-capped), when present. */
  detail: string | null;
  status: ActivityRowStatus;
  /** Highest wire seq applied to this row (stale-event guard). */
  seq: number;
  /** Real file children (search hits / file refs), capped by the adapter. */
  children: ActivityViewChild[];
  /** When this row is a merged group: how many same-kind ops it covers. */
  groupCount: number | null;
  /**
   * The repository-search query this row ran (repo_search rows only;
   * rendered as the inline chip beside "Searching repository"). Optional —
   * persisted v1 chains predate it and simply render without the chip.
   */
  query?: string | null;
}

/** Why a run is (or was) waiting on the user. */
export type ActivityWaitingKind = "approval" | "question";

/** Immutable snapshot consumed by the activity-chain UI via useSyncExternalStore. */
export interface RunActivitySnapshot {
  runId: string;
  /** idle = registered but no events yet; final = terminal state reached. */
  status: "idle" | "running" | "waiting" | "final";
  /** Current work phase (meaningful while running/waiting). */
  phase: Extract<ActivityPhase, "thinking" | "solving">;
  /** Set while status === "waiting" (also kept as history after resume). */
  waitingKind: ActivityWaitingKind | null;
  /** The active intake batch while paused (question flow), when present. */
  questionBatch: unknown | null;
  /** Renderable timeline rows (grouped + capped by the adapter). */
  rows: ActivityViewRow[];
  /** Rows hidden behind the "Earlier steps" expander (row cap). */
  hiddenEarlierCount: number;
  /** True once the FIRST final-answer chunk closed the work phase. */
  workFinalized: boolean;
  /** True once any mutating/executing activity was really received. */
  reachedSolving: boolean;
  /** Active work time (waiting excluded), ms — frozen when workFinalized. */
  activeMs: number;
  /** Terminal state (null while the run is still active). */
  finalState: "completed" | "failed" | "cancelled" | null;
  /** Epoch ms the run started (server RUN_STARTED timestamp when present). */
  startedAt: number | null;
  /** Epoch ms the run reached its terminal state. */
  endedAt: number | null;
}

/**
 * Persisted activity chain — stored with the chat message so a reload keeps
 * the completed timeline and final duration. Rows are view rows replayed
 * 1:1; no wire payload is persisted.
 */
export interface PersistedActivityChain {
  version: 1;
  runId: string;
  phase: Extract<ActivityPhase, "thinking" | "solving">;
  reachedSolving: boolean;
  /** Last waiting state seen (informational history). */
  waitingKind: ActivityWaitingKind | null;
  rows: ActivityViewRow[];
  hiddenEarlierCount: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Active work time (waiting excluded), ms. */
  activeMs: number | null;
  finalState: "completed" | "failed" | "cancelled" | null;
}
