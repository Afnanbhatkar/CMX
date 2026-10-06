/**
 * CodeMind X V2 — Phase 9 Multi-Agent Orchestrator contracts.
 *
 * Every agent is a contract, not a function soup (Phase 9 spec §3):
 * name, version, status, input/output schemas, allowed tools, timeout,
 * approval policy and retry policy live in the registry (registry.ts);
 * every execution produces the same AgentResult shape.
 *
 * Security posture (Phase 9 spec §4 + PROJECT_SAFETY.md):
 * - Tool permissions are enforced IN CODE (tools.ts), never by prompting.
 * - Repository content is UNTRUSTED DATA: it is fenced and labeled when it
 *   enters any prompt and can never elevate an agent's permissions.
 * - No agent in this phase writes to disk. The coding agent PROPOSES
 *   change-sets only; applying requires the change-set workflow and an
 *   explicit human approval, and even then nothing touches the filesystem
 *   (the build has zero disk-write endpoints by design).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Agent vocabulary                                                    */
/* ------------------------------------------------------------------ */

/** Core agents (spec §1) — the orchestrator is the engine itself, not a span. */
export const CORE_AGENT_NAMES = [
  "planner",
  "retrieval",
  "code-analyst",
  "graph",
  "reasoning",
  "critic",
] as const;

/** Specialist agents (spec §1). Implemented ones do real tool work. */
export const SPECIALIST_AGENT_NAMES = [
  "security",
  "dependency",
  "git",
  "coding",
  "testing",
  "documentation",
  "debugger",
  "architecture",
  "performance",
  "refactoring",
  "migration",
  "release",
  "sandbox",
] as const;

export const AGENT_NAMES = [
  ...CORE_AGENT_NAMES,
  ...SPECIALIST_AGENT_NAMES,
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/** Honest capability status (RULES.md §9 — never fabricate availability). */
export type AgentCapabilityStatus = "implemented" | "planned";

/** Registry status of one agent execution (spec §3 output.status). */
export type AgentRunStatus =
  | "completed"
  | "failed"
  | "timeout"
  | "skipped"
  | "cancelled"
  | "awaiting-approval";

/* ------------------------------------------------------------------ */
/* Tools + permissions (spec §4)                                       */
/* ------------------------------------------------------------------ */

export const TOOL_NAMES = [
  "repo.search",
  "repo.read-file",
  "repo.read-tree",
  "repo.symbol-scan",
  "git.read-overview",
  "git.read-commits",
  "git.mutate",
  "code.propose-changes",
  "code.apply-changes",
  "static.security-scan",
  "graph.import-graph",
  "deps.scan",
  "sandbox.execute",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Permission tiers from spec §4, enforced in tools.ts — never in prompts. */
export type ToolPermissionTier =
  | "read-search-only"
  | "read-analyze-only"
  | "read-propose-only"
  | "read-static-analysis-only"
  | "isolated-execution-only";

export interface ToolGrant {
  tool: ToolName;
  /** Why the grant exists — shown in the registry UI. */
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Evidence + result contract (spec §3 output)                         */
/* ------------------------------------------------------------------ */

/** One piece of evidence: a real location + why it supports the finding. */
export interface Evidence {
  path: string;
  line: number | null;
  /** Short quoted snippet (≤ 240 chars) — never whole files. */
  snippet: string;
  why: string;
}

/** Honest confidence tier — same vocabulary as the search engine. */
export type Confidence = "high" | "probable" | "weak";

/** The ONE shape every agent execution returns (spec §3). */
export interface AgentResult {
  agent: AgentName;
  status: AgentRunStatus;
  /** Short operational findings — never internal reasoning. */
  findings: string[];
  evidence: Evidence[];
  confidence: Confidence;
  /** Real source paths the agent's findings rest on. */
  sources: string[];
  /** Suggested next step, or null. The critic may set "retrieve-again". */
  nextAction: string | null;
  /** Execution metadata (observability §8). */
  attempts: number;
  toolCount: number;
  durationMs: number;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* Plan + intent (spec §2)                                             */
/* ------------------------------------------------------------------ */

export const INTENT_KINDS = [
  "question",
  "search",
  "architecture",
  "security",
  "coding",
  "multi-agent",
] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

export interface OrchestrationIntent {
  kind: IntentKind;
  /** One-line normalized restatement of the user request. */
  summary: string;
}

/** One planned step = one agent invocation with its instruction. */
export interface PlanStep {
  id: string;
  agent: AgentName;
  instruction: string;
  /** Step ids that must complete before this one starts. */
  dependsOn: string[];
}

export interface OrchestrationPlan {
  intent: OrchestrationIntent;
  steps: PlanStep[];
}

/* ------------------------------------------------------------------ */
/* Critic verdict (spec §7)                                            */
/* ------------------------------------------------------------------ */

export const CRITIC_ISSUE_KINDS = [
  "unsupported-claim",
  "wrong-file-reference",
  "missing-evidence",
  "irrelevant-context",
  "contradiction",
  "incorrect-assumption",
] as const;

export type CriticIssueKind = (typeof CRITIC_ISSUE_KINDS)[number];

export interface CriticIssue {
  kind: CriticIssueKind;
  detail: string;
  path: string | null;
}

export type CriticVerdict = "supported" | "weak-evidence" | "unverified";

/* ------------------------------------------------------------------ */
/* Run input / result                                                  */
/* ------------------------------------------------------------------ */

/** Drill switch for the acceptance scenarios (failed agent / timeout / retry). */
export interface FaultInjection {
  agent: AgentName;
  /** "error" fails every attempt, "error-once" fails the first attempt only, */
  /** "timeout" stalls past the agent's deadline. */
  mode: "error" | "error-once" | "timeout";
}

export interface OrchestratorRunInput {
  request: string;
  /** Optional preset label from the console (acceptance scenarios). */
  preset?: string | null;
  /** Drill fault injection — default off, used by acceptance verification. */
  fault?: FaultInjection | null;
}

export interface OrchestrationApprovalView {
  id: string;
  kind: string;
  status: string;
  whatWillChange: string;
  affectedFiles: string[];
  whyApprovalNeeded: string;
  risk: string;
  requestedPermission: string;
}

export interface OrchestrationChangeSetView {
  publicId: string;
  title: string;
  status: string;
  description: string | null;
  changes: { path: string; changeKind: string; status: string; diff: string | null }[];
}

/** Full run state returned by the status endpoint (and polled by the UI). */
export interface OrchestrationRunState {
  runPublicId: string;
  status:
    | "queued"
    | "running"
    | "waiting-approval"
    | "completed"
    | "failed"
    | "cancelled";
  input: OrchestratorRunInput;
  intent: OrchestrationIntent | null;
  plan: OrchestrationPlan | null;
  spans: (AgentResult & { wave: number })[];
  answer: string | null;
  criticVerdict: CriticVerdict | null;
  criticIssues: CriticIssue[];
  retrievedAgain: boolean;
  approvals: OrchestrationApprovalView[];
  changeSets: OrchestrationChangeSetView[];
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

/* ------------------------------------------------------------------ */
/* Zod schemas — LLM structured outputs (lenient, fenced prompts)      */
/* ------------------------------------------------------------------ */

export const intentSchema = z.object({
  kind: z.enum(INTENT_KINDS),
  summary: z.string().min(1).max(400),
});

export const planStepSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  instruction: z.string().min(1).max(1200),
  dependsOn: z.array(z.string().max(80)).max(12).default([]),
});

export const planSchema = z.object({
  intent: intentSchema,
  steps: z.array(planStepSchema).min(1).max(10),
});

export const reasoningSchema = z.object({
  answer: z.string().min(1).max(8000),
  claims: z
    .array(
      z.object({
        claim: z.string().min(1).max(600),
        supportPaths: z.array(z.string().max(400)).max(10).default([]),
      }),
    )
    .max(12)
    .default([]),
});

export const criticSchema = z.object({
  verdict: z.enum(["supported", "weak-evidence", "unverified"]),
  issues: z
    .array(
      z.object({
        kind: z.enum(CRITIC_ISSUE_KINDS),
        detail: z.string().min(1).max(600),
        path: z.string().max(400).nullable().default(null),
      }),
    )
    .max(12)
    .default([]),
  retrieveAgain: z.boolean().default(false),
});

export const codingProposalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1200).default(""),
  changes: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        changeKind: z.enum(["add", "modify", "delete"]),
        /** Unified-diff-style proposal text (preview only — never applied). */
        diff: z.string().min(1).max(20000),
        rationale: z.string().max(600).default(""),
      }),
    )
    .min(1)
    .max(6),
});

/** Parse a JSON object out of a model response (fences tolerated). */
export function parseJsonFromModel<T>(
  raw: string,
  schema: z.ZodType<T>,
): T | null {
  const trimmed = raw.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const candidates = [withoutFences];
  const firstBrace = withoutFences.indexOf("{");
  const lastBrace = withoutFences.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFences.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // try next candidate
    }
  }
  return null;
}
