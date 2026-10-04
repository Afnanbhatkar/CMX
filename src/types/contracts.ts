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
