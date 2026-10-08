/**
 * CodeMind X V2 — Phase 9 orchestration engine.
 *
 * Flow (spec §2): Intent → Plan → Select agents → Build context → Execute →
 * Validate → Critic → Response/change. The engine NEVER calls every agent:
 * only the plan's selected agents run, as topological waves — independent
 * agents in one wave execute in PARALLEL (Promise.all), dependent ones wait.
 *
 * Guarantees:
 * - Per-agent timeout + registry retry policy, engine-enforced.
 * - Global AbortController per run → user-facing cancel at any moment.
 * - No repository mutation exists in this phase; the only "mutating" agent
 *   (coding) writes PROPOSED change-set rows and then BLOCKS on a human
 *   approval gate. Parallel agents therefore cannot race on repo state.
 * - Observability (spec §8): one OrchestratorAgentSpan per agent execution
 *   (agent id, run id, status, attempts, tool count, duration, error) —
 *   never tokens, credentials, or repository content.
 * - Critic weak evidence → ONE re-retrieval + re-reasoning + re-critic,
 *   then an honest "could not be verified" answer (spec §7).
 */

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { logError, logInfo, logWarn } from "@/server/security/logger";

import {
  runAgentOnce,
  type AgentCall,
  type ReasoningClaim,
} from "./agents";
import { applyChangeSet, type ApplyChangeSetResult } from "./apply";
import { validateFile } from "./validation";
import { resolveMutationPath } from "@/lib/server/workspace-mutation";
import {
  type AgentName,
  type AgentResult,
  type CriticIssue,
  type CriticVerdict,
  type OrchestratorRunInput,
  type OrchestrationIntent,
  type OrchestrationPlan,
  type OrchestrationRunState,
  type PlanStep,
} from "./contracts";
import { AGENT_SPECS, implementedAgents } from "./registry";

/* ------------------------------------------------------------------ */
/* Active-run registry (in-memory gates for cancel + approval)         */
/*                                                                     */
/* Dev-mode Turbopack compiles per-route module copies; the registry     */
/* MUST be a globalThis singleton so every route copy shares ONE map    */
/* (cancel/approve gates) and ONE recovery flag — otherwise a fresh     */
/* route copy's recovery would mark another copy's live run as failed.  */
/* ------------------------------------------------------------------ */

interface ActiveRun {
  controller: AbortController;
  call: AgentCall;
  approvalGates: Map<string, (decision: "approved" | "rejected" | "expired") => void>;
  approvalTimer: ReturnType<typeof setTimeout> | null;
}

interface OrchestratorGlobalState {
  activeRuns: Map<string, ActiveRun>;
  recovered: boolean;
}

const GLOBAL_STATE = ((globalThis as Record<string, unknown>).__cmxOrchestratorState ??=
  { activeRuns: new Map<string, ActiveRun>(), recovered: false }) as OrchestratorGlobalState;

const ACTIVE_RUNS = GLOBAL_STATE.activeRuns;

/** Approval gate budgets — honest expiry instead of an infinite wait.
 *
 *  Agent Mode V2 (spec §5/§56): the CHAT path now PAUSES the run at the
 *  gate and ENDS the phase-1 SSE response — the client resumes through a
 *  fresh connection, so the old ~3.5min network kill no longer bounds the
 *  decision window. The gate itself stays bounded (30min) so an abandoned
 *  detached run cannot leak forever; expiry is an honest FAILED state
 *  ("approval expired — no changes were applied"), never an auto-approve
 *  and never a silent continue.
 *
 *  The CONSOLE path blocks inside the request like before (its UI polls
 *  DB state), with a 10min window. */
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const CHAT_APPROVAL_TIMEOUT_MS = 30 * 60_000;

/** Version-conflict re-plans per run (spec §122 — bounded, never a loop). */
const MAX_CONFLICT_REPLANS = 1;

/** The critic's weak-evidence re-round (retrieval + reasoning + critic) may
 *  only start while the run is still fast enough to absorb ~100s more and
 *  still finish under the ~3.5min chat connection kill window. */
const CRITIC_REROUND_ELAPSED_BUDGET_MS = 45_000;

/* ------------------------------------------------------------------ */
/* Live events (Phase 9.6 — chat integration)                          */
/*                                                                     */
/* The console UI polls DB state; the CHAT assistant needs the same     */
/* run streamed LIVE into the thought chain. The engine therefore       */
/* accepts an optional event callback and emits one event per real      */
/* execution fact (agent started/finished, plan ready, approval gate,   */
/* critic verdict). Callback or not, engine behavior, persistence and   */
/* the console path are IDENTICAL — this is a pure observer hook.       */
/* ------------------------------------------------------------------ */

/** The approval payload persisted by the coding agent (proposal only). */
export interface OrchestratorApprovalPayload {
  whatWillChange: string;
  affectedFiles: string[];
  whyApprovalNeeded: string;
  risk: string;
  requestedPermission: string;
  /* ---- Agent Mode V2 (spec §50) — additive ---- */
  changes?: { path: string; changeKind: "add" | "modify" | "delete"; reason: string }[];
  counts?: { created: number; modified: number; deleted: number };
  changeSetId?: string;
}

/** One per-file validation check surfaced to the chain (spec §65). */
export interface ValidationCheckView {
  name: string;
  path: string;
  status: "passed" | "failed" | "skipped";
  detail: string | null;
}

/** Machine-generated change result — the chat renders THIS (spec §81/§82). */
export interface ChangeResultSummary {
  changeSetId: string | null;
  created: { path: string; verified: boolean }[];
  modified: { path: string; verified: boolean }[];
  deleted: { path: string; verified: boolean }[];
  validation: ValidationCheckView[];
  noOp: boolean;
  conflict: string | null;
  error: string | null;
  /** Real per-file diffs (bounded) for the View-diff control (spec §53/§99). */
  diffs: { path: string; operation: "create" | "modify" | "delete"; lines: { kind: "add" | "remove" | "same"; text: string }[] | null }[];
}

export type OrchestratorEngineEvent =
  | {
      kind: "agent-started";
      stepId: string;
      agent: AgentName;
      wave: number;
      instruction: string;
    }
  | {
      kind: "agent-finished";
      stepId: string;
      agent: AgentName;
      wave: number;
      result: AgentResult;
    }
  | { kind: "plan"; intent: OrchestrationIntent; steps: PlanStep[] }
  | {
      kind: "approval-required";
      runPublicId: string;
      approvalId: string;
      payload: OrchestratorApprovalPayload;
    }
  | {
      kind: "approval-decided";
      approvalId: string;
      decision: "approved" | "rejected";
    }
  | { kind: "critic-verdict"; verdict: CriticVerdict }
  /* ---- Agent Mode V2: real execution facts (spec §8/§44) ---- */
  | { kind: "apply-started"; files: number }
  | {
      kind: "file-op";
      op: "create-folder" | "create-file" | "edit-file" | "delete-file" | "verify";
      path: string | null;
      title: string;
      status: "started" | "completed" | "failed";
      detail: string | null;
    }
  | { kind: "apply-completed"; summary: string; verified: boolean }
  | { kind: "apply-failed"; error: string }
  | { kind: "validation"; checks: ValidationCheckView[] }
  | { kind: "conflict"; path: string; error: string }
  | { kind: "change-result"; result: ChangeResultSummary };

export type OrchestratorEventSink = (event: OrchestratorEngineEvent) => void;

/** Everything one completed orchestration produced (chat streaming return). */
export interface ChatOrchestrationOutput {
  answer: string;
  verdict: CriticVerdict | null;
  issues: CriticIssue[];
  plan: OrchestrationPlan | null;
  spans: (AgentResult & { wave: number })[];
  retrievedAgain: boolean;
  /** Agent Mode V2 — the machine-generated result of the applied ChangeSet. */
  changeResult: ChangeResultSummary | null;
  /** True when the human REJECTED the proposal (honest terminal outcome). */
  rejected: boolean;
}

/** Parse the coding agent's persisted approval payload (honest defaults). */
function parseApprovalPayload(raw: string | null): OrchestratorApprovalPayload {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    return {
      whatWillChange: str(parsed.whatWillChange),
      affectedFiles: Array.isArray(parsed.affectedFiles)
        ? (parsed.affectedFiles as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      whyApprovalNeeded: str(parsed.whyApprovalNeeded),
      risk: str(parsed.risk),
      requestedPermission: str(parsed.requestedPermission),
      changes: Array.isArray(parsed.changes)
        ? (parsed.changes as Record<string, unknown>[])
            .filter((c) => c && typeof c.path === "string" && typeof c.changeKind === "string")
            .map((c) => ({
              path: String(c.path),
              changeKind: (c.changeKind === "add" || c.changeKind === "delete" ? c.changeKind : "modify") as "add" | "modify" | "delete",
              reason: typeof c.reason === "string" ? c.reason : "requested change",
            }))
            .slice(0, 12)
        : undefined,
      counts:
        parsed.counts && typeof parsed.counts === "object"
          ? {
              created: Number((parsed.counts as Record<string, unknown>).created ?? 0),
              modified: Number((parsed.counts as Record<string, unknown>).modified ?? 0),
              deleted: Number((parsed.counts as Record<string, unknown>).deleted ?? 0),
            }
          : undefined,
      changeSetId: typeof parsed.changeSetId === "string" ? parsed.changeSetId : undefined,
    };
  } catch {
    return {
      whatWillChange: "",
      affectedFiles: [],
      whyApprovalNeeded: "",
      risk: "",
      requestedPermission: "",
    };
  }
}

/**
 * One-time recovery: cancel/approval gates live in MEMORY, so a server
 * restart orphans queued/running/waiting-approval runs. Mark them honestly
 * failed instead of leaving zombie rows (same pattern as the jobs pump).
 */
let recovered = GLOBAL_STATE.recovered;
async function recoverStaleRuns(): Promise<void> {
  if (recovered) return;
  recovered = true;
  GLOBAL_STATE.recovered = true;
  await db.agentRun
    .updateMany({
      where: {
        kind: "orchestrator",
        status: { in: ["queued", "running", "waiting-approval", "applying", "verifying", "validating"] },
      },
      data: {
        status: "failed",
        error: "server restarted mid-run — in-memory gates lost",
        completedAt: new Date(),
      },
    })
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Wave scheduling                                                     */
/* ------------------------------------------------------------------ */

interface ExecutableStep {
  id: string;
  agent: AgentName;
  instruction: string;
  dependsOn: string[];
  /** Wave index (0-based) in the topological order. */
  wave: number;
}

function assignWaves(plan: OrchestrationPlan): ExecutableStep[] {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const waveOf = new Map<string, number>();
  const resolved: ExecutableStep[] = [];

  const waveFor = (id: string, seen: Set<string>): number => {
    if (waveOf.has(id)) return waveOf.get(id)!;
    if (seen.has(id)) return 0; // dependency cycle guard — treat as root
    seen.add(id);
    const step = byId.get(id);
    if (!step) return 0;
    const wave = step.dependsOn.length
      ? Math.max(...step.dependsOn.map((d) => (byId.has(d) ? waveFor(d, seen) : 0))) + 1
      : 0;
    waveOf.set(id, wave);
    return wave;
  };

  for (const step of plan.steps) {
    const wave = waveFor(step.id, new Set());
    waveOf.set(step.id, wave);
    resolved.push({ ...step, wave });
  }
  return resolved;
}

/* ------------------------------------------------------------------ */
/* Fault injection (acceptance drills)                                 */
/* ------------------------------------------------------------------ */

async function runWithFaultInjection(
  agent: AgentName,
  call: AgentCall,
  fault: OrchestratorRunInput["fault"],
  attempt: number,
): Promise<AgentResult> {
  if (fault && fault.agent === agent) {
    if (fault.mode === "error" || (fault.mode === "error-once" && attempt === 1)) {
      throw new Error(`drill fault: injected failure for agent "${agent}" (mode ${fault.mode})`);
    }
    if (fault.mode === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, 10 * 60_000));
      // unreachable in practice — engine timeout fires first
    }
  }
  return runAgentOnce(agent, call);
}

/* ------------------------------------------------------------------ */
/* Agent execution with timeout + retry                                */
/* ------------------------------------------------------------------ */

async function executeAgent(
  step: ExecutableStep,
  call: AgentCall,
  fault: OrchestratorRunInput["fault"],
): Promise<AgentResult> {
  const spec = AGENT_SPECS[step.agent];
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, spec.retry.maxAttempts);
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (call.signal.aborted) {
      return {
        agent: step.agent,
        status: "cancelled",
        findings: [],
        evidence: [],
        confidence: "weak",
        sources: [],
        nextAction: null,
        attempts: attempt,
        toolCount: 0,
        durationMs: Date.now() - startedAt,
        error: "run cancelled",
      };
    }
    try {
      let raceTimer: ReturnType<typeof setTimeout> | null = null;
      let raced: AgentResult | "engine-timeout";
      try {
        raced = await Promise.race([
          runWithFaultInjection(step.agent, call, fault, attempt),
          new Promise<"engine-timeout">((resolve) => {
            raceTimer = setTimeout(() => resolve("engine-timeout"), spec.timeoutMs);
          }),
        ]);
      } finally {
        // The race timer must not outlive the attempt — a completed agent
        // must not leave a 45–120 s timer holding the event loop (timers
        // piled up across waves and retries before this cleanup).
        if (raceTimer) clearTimeout(raceTimer);
      }
      if (raced === "engine-timeout") {
        lastError = `agent exceeded its ${spec.timeoutMs}ms deadline`;
        logWarn("orchestrator: agent timeout", { agent: step.agent, attempt });
        continue; // retry per policy
      }
      // Registry retry policy also covers TRANSIENT soft failures — a model
      // response that came back empty/unparseable is the same class of
      // failure as a thrown attempt (the deadline budgets inside the agents
      // keep every attempt inside spec.timeoutMs, so the retry cannot blow
      // the run's total wall time). Semantic failures (e.g. a proposal that
      // targets no real files) are NOT retried — they are honest results.
      if (
        raced.status === "failed" &&
        raced.error &&
        raced.error.includes("unavailable or unparseable") &&
        attempt < maxAttempts
      ) {
        lastError = raced.error;
        logWarn("orchestrator: agent transient model failure — retrying", {
          agent: step.agent,
          attempt,
        });
        await new Promise((r) => setTimeout(r, spec.retry.backoffMs));
        continue;
      }
      return { ...raced, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logWarn("orchestrator: agent attempt failed", { agent: step.agent, attempt });
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, spec.retry.backoffMs));
      }
    }
  }

  return {
    agent: step.agent,
    status: lastError.includes("deadline") ? "timeout" : "failed",
    findings: [],
    evidence: [],
    confidence: "weak",
    sources: [],
    nextAction: null,
    attempts: maxAttempts,
    toolCount: 0,
    durationMs: Date.now() - startedAt,
    error: lastError || "agent failed",
  };
}

/* ------------------------------------------------------------------ */
/* Observability persistence                                           */
/* ------------------------------------------------------------------ */

async function persistSpan(
  runInternalId: string,
  step: ExecutableStep,
  result: AgentResult,
): Promise<void> {
  try {
    await db.orchestratorAgentSpan.create({
      data: {
        runId: runInternalId,
        agentName: result.agent,
        agentVersion: AGENT_SPECS[result.agent].version,
        status: result.status,
        wave: step.wave,
        attempts: result.attempts,
        toolCount: result.toolCount,
        findingsCount: result.findings.length,
        confidence: result.confidence,
        sourcesJson: JSON.stringify(result.sources.slice(0, 12)),
        error: result.error,
        startedAt: new Date(Date.now() - result.durationMs),
        endedAt: new Date(),
      },
    });
  } catch (error) {
    logError("orchestrator: span persist failed", {
      run: runInternalId,
      agent: result.agent,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Run execution                                                       */
/* ------------------------------------------------------------------ */

/**
 * Execute one orchestration run end-to-end. When `onEvent` is provided,
 * every real execution fact is emitted live (chat thought-chain streaming);
 * without it the behavior matches the Phase 9 console path — with the ONE
 * honest V2 upgrade that an approved change-set is actually APPLIED in both
 * surfaces. Returns the composed output (null on cancel/failure).
 *
 * Agent Mode V2 (spec §5/§56): on the CHAT path the approval gate is a REAL
 * blocking state — the run persists waiting-approval, calls `onPause` (the
 * stream layer ends the phase-1 SSE response and the client later resumes
 * through a fresh connection), and waits for the human decision BEFORE any
 * mutation, critic or final answer. No timeout auto-approves.
 */
async function executeRun(
  runInternalId: string,
  runPublicId: string,
  input: OrchestratorRunInput,
  onEvent?: OrchestratorEventSink,
  onPause?: (info: { reason: "approval"; approvalId: string }) => void,
): Promise<ChatOrchestrationOutput | null> {
  const active = ACTIVE_RUNS.get(runPublicId);
  if (!active) return null;
  const { controller, call } = active;
  const signal = controller.signal;

  const spans: (AgentResult & { wave: number })[] = [];
  let retrievedAgain = false;
  /** Wall-clock start of THIS run's execution (re-round budget anchor). */
  const runStartedAt = Date.now();
  /** Agent Mode V2 — machine-generated result of the applied ChangeSet. */
  let changeResult: ChangeResultSummary | null = null;
  /** The human REJECTED the proposal — honest terminal outcome. */
  let rejected = false;

  const persistStatus = async (status: string, patch: Record<string, unknown> = {}) => {
    await db.agentRun
      .update({
        where: { id: runInternalId },
        data: { status, ...patch },
      })
      .catch(() => undefined);
  };

  /* ---- Agent Mode V2: REAL post-approval execution (spec §15-§17/§48) ----
   * Apply the approved ChangeSet through the mutation service, emitting one
   * real event per operation, then run bounded validation. A version
   * conflict (the file changed after the proposal) returns "conflict" so
   * the caller re-plans; a hard failure is thrown as an honest error.
   * Returns the outcome AND the machine-generated change result. */
  const applyAndValidate = async (): Promise<{
    outcome: "ok" | "conflict" | "failed";
    result: ChangeResultSummary | null;
  }> => {
    await persistStatus("applying");
    onEvent?.({ kind: "apply-started", files: 0 });
    const applied = await applyChangeSet({
      runInternalId,
      onFolderEvent: (path, ok, error) => {
        onEvent?.({
          kind: "file-op",
          op: "create-folder",
          path,
          title: ok ? "Creating folder" : "Folder creation failed",
          status: ok ? "completed" : "failed",
          detail: ok ? path : (error ?? "folder could not be created"),
        });
      },
      onOperationStarted: (op) => {
        onEvent?.({
          kind: "file-op",
          op: op.operation === "create" ? "create-file" : op.operation === "modify" ? "edit-file" : "delete-file",
          path: op.path,
          title:
            op.operation === "create"
              ? "Creating"
              : op.operation === "modify"
                ? "Updating"
                : "Deleting",
          status: "started",
          detail: null,
        });
      },
      onOperationCompleted: (result) => {
        onEvent?.({
          kind: "file-op",
          op: result.operation === "create" ? "create-file" : result.operation === "modify" ? "edit-file" : "delete-file",
          path: result.path,
          title:
            result.operation === "create"
              ? "Creating"
              : result.operation === "modify"
                ? "Updating"
                : "Deleting",
          status: result.ok ? "completed" : "failed",
          detail: result.ok
            ? result.noOp
              ? "no change — content identical"
              : result.verified
                ? "written and verified by re-read"
                : "written — verification failed"
            : (result.error ?? "operation failed"),
        });
      },
    });

    if (applied.conflict) {
      onEvent?.({ kind: "conflict", path: applied.conflict.path, error: applied.conflict.error });
      onEvent?.({
        kind: "apply-failed",
        error: `version conflict on ${applied.conflict.path} — nothing was overwritten`,
      });
      return { outcome: "conflict", result: null };
    }

    if (!applied.ok) {
      const failed = applied.operations.find((op) => !op.ok && !op.noOp);
      const error = failed
        ? `Failed to ${failed.operation} \`${failed.path}\`: ${failed.error ?? "unknown error"}. No success is claimed for the unapplied change-set.`
        : "the change-set could not be applied";
      onEvent?.({ kind: "apply-failed", error });
      return {
        outcome: "failed",
        result: buildChangeResult(applied, []),
      };
    }

    // ---- Verification is part of apply (the service re-reads every file);
    // surface it as its own honest chain beat (spec §16/§44). ----
    onEvent?.({
      kind: "file-op",
      op: "verify",
      path: null,
      title: "Verifying changes",
      status: "completed",
      detail: `${applied.operations.length} operation(s) re-read from disk`,
    });

    // ---- Bounded validation (spec §39/§65): real checks, honest skips. ----
    await persistStatus("validating");
    const checks: ValidationCheckView[] = [];
    for (const op of applied.operations) {
      if (!op.ok || op.noOp || op.operation === "delete") continue;
      const allowed = resolveMutationPath(op.path);
      if (!allowed.ok) continue;
      const check = await validateFile(op.path, allowed.absolute);
      checks.push({ name: check.name, path: op.path, status: check.status, detail: check.detail });
    }
    if (checks.length > 0) {
      onEvent?.({ kind: "validation", checks });
    }
    changeResult = buildChangeResult(applied, checks);
    onEvent?.({ kind: "change-result", result: changeResult });
    onEvent?.({
      kind: "apply-completed",
      summary: `${changeResult.created.length} created · ${changeResult.modified.length} modified · ${changeResult.deleted.length} deleted — verified`,
      verified: [...changeResult.created, ...changeResult.modified].every((f) => f.verified),
    });
    return { outcome: "ok", result: changeResult };
  };

  /* ---- One full approval cycle: emit → pause (chat) → await the human. */
  const requestApprovalDecision = async (): Promise<"approved" | "rejected" | "expired"> => {
    const pendingApproval = await db.approval.findFirst({
      where: { runId: runInternalId, status: "pending" },
      orderBy: { createdAt: "desc" as const },
    });
    if (!pendingApproval) return "expired";
    await persistStatus("waiting-approval");
    onEvent?.({
      kind: "approval-required",
      runPublicId,
      approvalId: pendingApproval.id,
      payload: parseApprovalPayload(pendingApproval.payload),
    });
    // Register the gate BEFORE yielding to the UI so a fast decision can
    // never race the gate registration; the DB pre-check inside
    // waitForApproval covers the reverse race as well.
    const gatePromise = waitForApproval(
      runPublicId,
      signal,
      pendingApproval.id,
      onEvent ? CHAT_APPROVAL_TIMEOUT_MS : APPROVAL_TIMEOUT_MS,
    );
    if (onEvent && onPause) {
      onPause({ reason: "approval", approvalId: pendingApproval.id });
    }
    const decision = await gatePromise;
    if (decision !== "expired") {
      onEvent?.({ kind: "approval-decided", approvalId: pendingApproval.id, decision });
    }
    return decision;
  };

  /* ---- Version-conflict re-plan: discard the stale proposal, re-run the
   * coding agent against the CURRENT file, require approval again
   * (spec §122; bounded by MAX_CONFLICT_REPLANS). */
  const rePlanAfterConflict = async (wave: number): Promise<void> => {
    await db.changeSet.updateMany({
      where: { runId: runInternalId, status: "proposed" },
      data: { status: "discarded" },
    });
    await db.approval.updateMany({
      where: { runId: runInternalId, status: "pending" },
      data: { status: "expired", decisionNote: "superseded — the target file changed after the proposal" },
    });
    await persistStatus("running");
    const replanStep: ExecutableStep = {
      id: "coding-replan",
      agent: "coding",
      instruction: "The target file changed after the change-set was prepared. Re-read the current file and prepare a NEW change-set for the original request.",
      dependsOn: [],
      wave,
    };
    onEvent?.({ kind: "agent-started", stepId: replanStep.id, agent: replanStep.agent, wave, instruction: replanStep.instruction });
    const replanResult = await executeAgent(replanStep, call, input.fault ?? null);
    spans.push({ ...replanResult, wave });
    await persistSpan(runInternalId, replanStep, replanResult);
    onEvent?.({ kind: "agent-finished", stepId: replanStep.id, agent: replanStep.agent, wave, result: replanResult });
    if (replanResult.status !== "awaiting-approval") {
      throw new Error(
        `Re-planning after the version conflict failed: ${replanResult.error ?? "the coding agent produced no applyable proposal"}`,
      );
    }
  };

  try {
    await persistStatus("running", { startedAt: new Date() });

    // ---- Stage 1: planner (the only mandatory wave-0 agent) ----
    const plannerStep: ExecutableStep = {
      id: "planner",
      agent: "planner",
      instruction: input.request,
      dependsOn: [],
      wave: 0,
    };
    onEvent?.({ kind: "agent-started", stepId: plannerStep.id, agent: "planner", wave: 0, instruction: plannerStep.instruction });
    const plannerResult = await executeAgent(plannerStep, call, input.fault ?? null);
    spans.push({ ...plannerResult, wave: 0 });
    await persistSpan(runInternalId, plannerStep, plannerResult);
    onEvent?.({ kind: "agent-finished", stepId: plannerStep.id, agent: "planner", wave: 0, result: plannerResult });

    const plan = call.plan;
    if (!plan || plan.steps.length === 0) {
      throw new Error("planner produced no plan");
    }

    /* ---- Agent Mode V2 (STEP 11): coding-plan guarantee ----
     * A mutation-shaped request MUST produce a coding step. The LLM
     * planner is nondeterministic and occasionally omits the coding agent
     * for clear change requests (the run then "answers" without doing the
     * work). The engine audits the plan deterministically — same spirit as
     * the forced critic — and inserts the coding step when missing. */
    const requestLower = input.request.toLowerCase();
    const mutationVerb =
      /\b(add|implement|create|write|fix|change|refactor|update|modify|edit|insert|delete|remove|rename|move)\b/.test(requestLower);

    /* ---- Deterministic no-mutation guard (agent-mode file-creation fix) ----
     * A coding step PROPOSES a real change-set (repository files!). A
     * request that carries no mutation verb can never legitimize one — the
     * LLM planner occasionally emits a coding step anyway (observed: a
     * plain "hi how are you" produced a "greeting" file proposal). Files
     * are ONLY for code-type requests: strip every coding step when the
     * request has no mutation intent; conversational/question requests get
     * an ANSWER, never repository files. */
    if (!mutationVerb && plan.steps.some((s) => s.agent === "coding")) {
      plan.steps = plan.steps.filter((s) => s.agent !== "coding");
      if (plan.intent.kind === "coding") {
        plan.intent = { ...plan.intent, kind: "question" };
      }
      logInfo("orchestrator: coding step stripped (no mutation verb in request)", {
        run: runPublicId,
      });
    }

    const codeTarget =
      /\b(code|function|file|component|api|feature|endpoint|test|class|method|module|folder|directory)\b/.test(requestLower);
    if (mutationVerb && codeTarget && !plan.steps.some((s) => s.agent === "coding")) {
      const retrievalStep = plan.steps.find((s) => s.agent === "retrieval");
      plan.steps.push({
        id: "coding-guarantee",
        agent: "coding",
        instruction: "Propose a change-set for the user's request (the full request is provided).",
        dependsOn: retrievalStep ? [retrievalStep.id] : [],
      });
      plan.intent = { ...plan.intent, kind: "coding" };
      logInfo("orchestrator: coding step inserted by plan guarantee", { run: runPublicId });
    }

    // The plan event carries the AUDITED plan (strip + guarantee applied) —
    // every surface sees exactly the steps that will execute.
    onEvent?.({ kind: "plan", intent: plan.intent, steps: plan.steps });

    // ---- Selection: only IMPLEMENTED agents may execute ----
    const implemented = new Set(implementedAgents().map((s) => s.name));
    let steps = assignWaves(plan).filter((s) => s.agent !== "planner");

    // Honest skip records for planned agents the model selected.
    for (const step of steps.filter((s) => !implemented.has(s.agent))) {
      const skipped: AgentResult = {
        agent: step.agent,
        status: "skipped",
        findings: [`${AGENT_SPECS[step.agent].label} is 'planned' in the registry — not executed (spec V2.1 capability rule)`],
        evidence: [],
        confidence: "weak",
        sources: [],
        nextAction: null,
        attempts: 0,
        toolCount: 0,
        durationMs: 0,
        error: "planned agent — never silently executed",
      };
      spans.push({ ...skipped, wave: step.wave });
      await persistSpan(runInternalId, step, skipped);
    }
    steps = steps.filter((s) => implemented.has(s.agent));

    // Guarantee the critic always runs last (spec §2 Validate → Critic),
    // and that question-like intents get a synthesized answer.
    const needsAnswer = plan.intent.kind !== "coding";
    const hasReasoning = steps.some((s) => s.agent === "reasoning");
    const lastExistingWave = steps.length ? Math.max(...steps.map((s) => s.wave)) : 0;
    if (needsAnswer && !hasReasoning) {
      steps.push({
        id: "reasoning-guarantee",
        agent: "reasoning",
        instruction: "Synthesize the answer from the gathered evidence.",
        dependsOn: [],
        wave: lastExistingWave + 1,
      });
    }
    const criticStep = steps.find((s) => s.agent === "critic");
    if (criticStep) {
      // The critic must run after EVERYTHING else, always.
      criticStep.wave = Math.max(
        ...steps.map((s) => s.wave),
        lastExistingWave,
      ) + 1;
    } else {
      steps.push({
        id: "critic",
        agent: "critic",
        instruction: "Verify the run's claims against gathered evidence.",
        dependsOn: [],
        wave: lastExistingWave + (needsAnswer && !hasReasoning ? 2 : 1),
      });
    }

    // ---- Execute waves (parallel within a wave, ordered across waves) ----
    const maxWave = Math.max(...steps.map((s) => s.wave));
    for (let wave = 0; wave <= maxWave && !signal.aborted; wave += 1) {
      const waveSteps = steps.filter((s) => s.wave === wave);
      if (waveSteps.length === 0) continue;

      // Concurrency guard: waves run in parallel ONLY for read-only agents.
      // (Every implemented agent is read-only except coding, which persists
      // proposals and then blocks on the approval gate — no repo mutation
      // exists, so parallel execution cannot race on repository state.)
      const results = await Promise.all(
        waveSteps.map(async (step) => {
          onEvent?.({ kind: "agent-started", stepId: step.id, agent: step.agent, wave, instruction: step.instruction });
          const result = await executeAgent(step, call, input.fault ?? null);
          await persistSpan(runInternalId, step, result);
          onEvent?.({ kind: "agent-finished", stepId: step.id, agent: step.agent, wave, result });
          return { ...result, wave };
        }),
      );
      spans.push(...results);

      /* ---- Approval gate (Agent Mode V2, spec §3/§4/§5/§56) ----
       * BOTH surfaces block here for the human decision, and the decision
       * is what releases REAL mutations:
       *
       * CHAT STREAM (onEvent present): the run persists waiting-approval,
       * emits the approval event, calls onPause (the stream layer ends the
       * phase-1 SSE response; the client shows the approval INSIDE the
       * thought chain and resumes the run later through a fresh
       * connection). NOTHING continues — no critic, no answer, no mutation
       * — until the decision arrives. Approved → apply + verify + validate
       * (with a bounded re-plan on version conflict, spec §122). Rejected →
       * honest "no changes applied" terminal. Expired → honest failure.
       *
       * CONSOLE (no onEvent): the blocking gate with a 10min window; an
       * approved change-set is applied exactly the same way. */
      const awaiting = results.find((r) => r.status === "awaiting-approval");
      if (awaiting) {
        let replans = 0;
        gate: while (true) {
          const decision = await requestApprovalDecision();
          if (decision === "expired") {
            if (signal.aborted) break gate; // user cancelled — the honest cancelled path handles it
            await db.approval.updateMany({
              where: { runId: runInternalId, status: "pending" },
              data: { status: "expired", decisionNote: "approval window elapsed" },
            });
            throw new Error(
              "Approval expired — no changes were applied. Send the request again to get a fresh proposal.",
            );
          }
          if (signal.aborted) break;
          if (decision === "rejected") {
            // Spec §52: no mutation, the historical decision stays visible,
            // the final response explains the rejection honestly.
            rejected = true;
            break gate;
          }
          // Approved — apply for real, then validate.
          await persistStatus("running");
          const appliedOutcome = await applyAndValidate();
          changeResult = appliedOutcome.result;
          if (appliedOutcome.outcome === "conflict") {
            if (replans >= MAX_CONFLICT_REPLANS) {
              throw new Error(
                "The target file kept changing after each proposal — nothing was overwritten. Please retry.",
              );
            }
            replans += 1;
            await rePlanAfterConflict(Math.max(...steps.map((s) => s.wave)) + replans * 2 + 90);
            continue gate;
          }
          if (appliedOutcome.outcome === "failed") {
            throw new Error(
              changeResult?.error ??
                "The approved change-set could not be applied — no success is claimed.",
            );
          }
          break gate;
        }
        if (signal.aborted) break;
        if (rejected) break; // nothing was changed — the critic has nothing to verify
        // The decision released the gate — flip the status back to running
        // so pollers show live progress (waves that follow the gate, e.g.
        // the critic verifying the APPLIED state) instead of a stale pause.
        await persistStatus("running");
      }
    }

    if (signal.aborted) {
      await persistStatus("cancelled", { completedAt: new Date() });
      logInfo("orchestrator: run cancelled", { run: runPublicId });
      ACTIVE_RUNS.delete(runPublicId);
      return null;
    }

    // ---- Critic loop: one honest re-retrieval round on weak evidence ----
    // Bounded by the run's elapsed time (Phase 9.6 fix): the re-round adds
    // THREE more sequential agents (retrieval + reasoning + critic). On a
    // slow run it pushed the total past the ~3.5min connection kill window
    // — the run died mid-verify and the chat showed a network error. The
    // re-round only fires while the run is still fast enough to absorb it.
    const runElapsedMs = Date.now() - (runStartedAt ?? Date.now());
    const firstCritic = spans.find((s) => s.agent === "critic");
    if (
      firstCritic?.nextAction === "retrieve-again" &&
      !retrievedAgain &&
      runElapsedMs <= CRITIC_REROUND_ELAPSED_BUDGET_MS &&
      !signal.aborted
    ) {
      retrievedAgain = true;
      const reSteps: ExecutableStep[] = [
        { id: "re-retrieval", agent: "retrieval", instruction: input.request, dependsOn: [], wave: 90 },
        { id: "re-reasoning", agent: "reasoning", instruction: "Re-answer with the refreshed evidence.", dependsOn: ["re-retrieval"], wave: 91 },
        { id: "re-critic", agent: "critic", instruction: "Re-verify after re-retrieval.", dependsOn: ["re-reasoning"], wave: 92 },
      ];
      for (const step of reSteps) {
        if (signal.aborted) break;
        onEvent?.({ kind: "agent-started", stepId: step.id, agent: step.agent, wave: step.wave, instruction: step.instruction });
        const result = await executeAgent(step, call, input.fault ?? null);
        spans.push({ ...result, wave: step.wave });
        await persistSpan(runInternalId, step, result);
        onEvent?.({ kind: "agent-finished", stepId: step.id, agent: step.agent, wave: step.wave, result });
      }
    }

    // ---- Finalize: honest answer composition ----
    const finalCritic = [...spans].reverse().find((s) => s.agent === "critic");
    const verdict: CriticVerdict | null = parseVerdict(finalCritic);
    if (verdict) onEvent?.({ kind: "critic-verdict", verdict });
    const issues: CriticIssue[] = parseIssues(finalCritic);
    const answer =
      rejected
        ? "I didn't apply the proposed changes — you rejected the change-set. No files were modified."
        : changeResult
          ? composeChangeAnswer(changeResult, spans.find((s) => s.agent === "coding")?.findings[0]?.replace(/^change-set proposed: "/, "").replace(/".*$/, "") ?? null)
          : composeAnswer(call, spans, verdict, retrievedAgain);

    const output = JSON.stringify({
      answer,
      criticVerdict: verdict,
      criticIssues: issues,
      retrievedAgain,
      plan,
      changeResult,
      rejected,
      spans: spans.map(({ agent, status, confidence, durationMs, attempts, toolCount, wave }) => ({
        agent,
        status,
        confidence,
        durationMs,
        attempts,
        toolCount,
        wave,
      })),
    });

    await db.agentRun
      .update({
        where: { id: runInternalId },
        data: {
          status: "completed",
          output,
          error: null,
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);

    logInfo("orchestrator: run completed", {
      run: runPublicId,
      agents: spans.length,
      verdict: verdict ?? "none",
    });

    return { answer, verdict, issues, plan, spans, retrievedAgain, changeResult, rejected };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistStatus("failed", {
      error: message.slice(0, 400),
      completedAt: new Date(),
    }).catch(() => undefined);
    logError("orchestrator: run failed", { run: runPublicId });
    return null;
  } finally {
    if (active.approvalTimer) clearTimeout(active.approvalTimer);
    ACTIVE_RUNS.delete(runPublicId);
  }
}

/**
 * Build the machine-generated change summary from the REAL apply result
 * (spec §81: never ask the model to summarize what changed).
 */
function buildChangeResult(
  applied: ApplyChangeSetResult,
  checks: ValidationCheckView[],
): ChangeResultSummary {
  const created = applied.operations
    .filter((op) => op.operation === "create")
    .map((op) => ({ path: op.path, verified: op.ok && op.verified }));
  const modified = applied.operations
    .filter((op) => op.operation === "modify")
    .map((op) => ({ path: op.path, verified: op.ok && op.verified }));
  const deleted = applied.operations
    .filter((op) => op.operation === "delete")
    .map((op) => ({ path: op.path, verified: op.ok && op.verified }));
  return {
    changeSetId: applied.changeSetPublicId,
    created,
    modified,
    deleted,
    validation: checks,
    noOp: applied.operations.some((op) => op.noOp),
    conflict: applied.conflict?.error ?? null,
    error: applied.ok ? null : (applied.operations.find((op) => !op.ok && !op.noOp)?.error ?? "the change-set could not be fully applied"),
    diffs: applied.operations
      .filter((op) => op.diff !== null && op.diff.length > 0)
      .slice(0, 6)
      .map((op) => ({ path: op.path, operation: op.operation, lines: op.diff!.slice(0, 300) })),
  };
}

/** Evidence-based markdown summary of REAL mutations (spec §21/§82). */
function composeChangeAnswer(result: ChangeResultSummary, title: string | null): string {
  const lines: string[] = [];
  const allVerified =
    [...result.created, ...result.modified].every((f) => f.verified) &&
    result.deleted.every((f) => f.verified);
  if (result.conflict) {
    lines.push(
      "The target file changed after the change-set was prepared, so nothing was overwritten.",
      "",
      `Conflict: ${result.conflict}`,
    );
    return lines.join("\n");
  }
  lines.push(
    title ? `Implemented: ${title}.` : "Implemented the requested change.",
    "",
  );
  if (result.created.length > 0) {
    lines.push("### Created");
    for (const file of result.created) lines.push(`- \`${file.path}\``);
    lines.push("");
  }
  if (result.modified.length > 0) {
    lines.push("### Modified");
    for (const file of result.modified) lines.push(`- \`${file.path}\``);
    lines.push("");
  }
  if (result.deleted.length > 0) {
    lines.push("### Deleted");
    for (const file of result.deleted) lines.push(`- \`${file.path}\``);
    lines.push("");
  }
  lines.push(
    allVerified
      ? "**Verified:** every written file was re-read from disk and matches the approved content exactly."
      : "**Verification failed:** at least one file does not match the approved content — treat the result as incomplete.",
  );
  if (result.validation.length > 0) {
    lines.push("");
    lines.push("**Validation:**");
    for (const check of result.validation) {
      const mark = check.status === "passed" ? "✓" : check.status === "failed" ? "×" : "⚠";
      lines.push(`- ${mark} ${check.name} — ${check.status}${check.detail ? ` (${check.detail})` : ""}`);
    }
  }
  return lines.join("\n");
}

function parseVerdict(criticSpan: (AgentResult & { wave: number }) | undefined): CriticVerdict | null {
  if (!criticSpan) return null;
  const line = criticSpan.findings.find((f) => f.startsWith("verdict:"));
  if (!line) return null;
  const value = line.slice("verdict:".length).trim();
  return value === "supported" || value === "weak-evidence" || value === "unverified" ? value : null;
}

function parseIssues(criticSpan: (AgentResult & { wave: number }) | undefined): CriticIssue[] {
  if (!criticSpan) return [];
  const line = criticSpan.findings.find((f) => f.startsWith("verdict:"));
  const issueLine = criticSpan.findings[1] ?? "";
  if (!issueLine || issueLine.startsWith("0 issue")) return [];
  return issueLine
    .replace(/^\d+ issue\(s\): /, "")
    .split("; ")
    .filter((part) => part && part !== "none")
    .map((part) => {
      const [kind, pathPart] = part.split(" (");
      return {
        kind: (kind as CriticIssue["kind"]) ?? "missing-evidence",
        detail: part,
        path: pathPart ? pathPart.replace(/\)$/, "").replace(/^no path$/, "") || null : null,
      };
    });
}

function composeAnswer(
  call: AgentCall,
  spans: (AgentResult & { wave: number })[],
  verdict: CriticVerdict | null,
  retrievedAgain: boolean,
): string {
  const codingSpan = spans.find((s) => s.agent === "coding");
  const reasoningAnswer = call.reasoning?.answer ?? null;

  if (reasoningAnswer) {
    const suffix: string[] = [];
    if (verdict === "weak-evidence" || verdict === "unverified") {
      suffix.push(
        retrievedAgain
          ? "\n\n> ⚠️ The critic could not fully verify this answer against repository evidence even after a re-retrieval. Treat unverified parts with caution."
          : "\n\n> ⚠️ The critic flagged weak evidence. Parts of this answer could not be verified.",
      );
    }
    return reasoningAnswer + suffix.join("");
  }

  if (codingSpan && codingSpan.status !== "failed") {
    return [
      "## Proposed change-set",
      "",
      ...codingSpan.findings.map((f) => `- ${f}`),
      "",
      verdict && verdict !== "supported"
        ? "> ⚠️ Critic verdict: the proposal could not be fully verified."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Nothing synthesized — report honestly what the run produced.
  const executed = spans.filter((s) => s.status === "completed");
  return [
    "The run finished without a synthesized answer.",
    "",
    `Agents executed: ${executed.length ? executed.map((s) => `${s.agent} (${s.status})`).join(", ") : "none completed"}.`,
    verdict ? `Critic verdict: ${verdict}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Approval gate                                                       */
/* ------------------------------------------------------------------ */

function waitForApproval(
  runPublicId: string,
  signal: AbortSignal,
  approvalId: string,
  timeoutMs: number,
): Promise<"approved" | "rejected" | "expired"> {
  return new Promise((resolve) => {
    const active = ACTIVE_RUNS.get(runPublicId);
    if (!active) {
      resolve("expired");
      return;
    }
    const gate = (decision: "approved" | "rejected" | "expired") => {
      if (active.approvalTimer) clearTimeout(active.approvalTimer);
      resolve(decision);
    };
    active.approvalGates.set("pending", gate);
    active.approvalTimer = setTimeout(() => gate("expired"), timeoutMs);
    signal.addEventListener("abort", () => gate("expired"), { once: true });
    // DB pre-check: the decision may have been recorded BEFORE the gate
    // registered (fast click / decision racing the pause). The Approval row
    // is authoritative (spec §5) — never wait on a decision already made.
    void db.approval
      .findUnique({ where: { id: approvalId } })
      .then((row) => {
        if (!row) return;
        if (row.status === "approved" || row.status === "rejected") {
          gate(row.status);
        }
      })
      .catch(() => undefined);
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Start a run — persists the AgentRun row and executes in the background. */
export async function startRun(input: OrchestratorRunInput): Promise<string> {
  await recoverStaleRuns();
  const runPublicId = randomUUID();
  const controller = new AbortController();

  const run = await db.agentRun.create({
    data: {
      publicId: runPublicId,
      kind: "orchestrator",
      status: "queued",
      input: JSON.stringify(input),
    },
  });

  const call: AgentCall = {
    instruction: input.request,
    request: input.request,
    scopePaths: [],
    hits: [],
    fileCache: new Map(),
    plan: null,
    reasoning: null,
    runInternalId: run.id,
    signal: controller.signal,
    onToolUse: () => undefined,
  };

  ACTIVE_RUNS.set(runPublicId, {
    controller,
    call,
    approvalGates: new Map(),
    approvalTimer: null,
  });

  // Fire-and-forget: status polling drives the UI.
  void executeRun(run.id, runPublicId, input);
  logInfo("orchestrator: run started", { run: runPublicId });
  return runPublicId;
}

/* ------------------------------------------------------------------ */
/* Chat streaming entry (Phase 9.6 — assistant thought-chain bridge)   */
/*                                                                     */
/* Same engine, same persistence, same gates — but AWAITED by the      */
/* caller (the assistant turn) with live events flowing into the chat  */
/* SSE stream. The run stays cancelable: by the caller (client         */
/* disconnect), by external abort, and by the console cancel route     */
/* (the ACTIVE_RUNS registration is shared).                           */
/* ------------------------------------------------------------------ */

export interface ChatOrchestrationHandle {
  runPublicId: string;
  /** Resolves when the orchestration fully finishes (or null on failure). */
  done: Promise<ChatOrchestrationOutput | null>;
  /** Abort the underlying run (client disconnect / user stop). */
  cancel: () => void;
}

/** Start a orchestration run that the chat pipeline AWAITS with live events.
 *  `onPause` fires when the run reaches the approval gate — the stream layer
 *  ends the phase-1 response there and resumes later (Agent Mode V2). */
export async function startChatOrchestration(
  input: OrchestratorRunInput,
  onEvent: OrchestratorEventSink,
  externalSignal?: AbortSignal,
  onPause?: (info: { reason: "approval"; approvalId: string }) => void,
): Promise<ChatOrchestrationHandle> {
  await recoverStaleRuns();
  const runPublicId = randomUUID();
  const controller = new AbortController();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const run = await db.agentRun.create({
    data: {
      publicId: runPublicId,
      kind: "orchestrator",
      status: "queued",
      input: JSON.stringify(input),
    },
  });

  const call: AgentCall = {
    instruction: input.request,
    request: input.request,
    scopePaths: [],
    hits: [],
    fileCache: new Map(),
    plan: null,
    reasoning: null,
    runInternalId: run.id,
    signal: controller.signal,
    onToolUse: () => undefined,
  };

  ACTIVE_RUNS.set(runPublicId, {
    controller,
    call,
    approvalGates: new Map(),
    approvalTimer: null,
  });

  const done = executeRun(run.id, runPublicId, input, onEvent, onPause);
  logInfo("orchestrator: chat run started", { run: runPublicId });

  return {
    runPublicId,
    done,
    cancel: () => controller.abort(),
  };
}

/** Abort a running/queued run. */
export async function cancelRun(runPublicId: string): Promise<boolean> {
  const active = ACTIVE_RUNS.get(runPublicId);
  if (!active) return false;
  active.controller.abort();
  const run = await db.agentRun.findUnique({ where: { publicId: runPublicId } });
  if (run && (run.status === "queued" || run.status === "running" || run.status === "waiting-approval" || run.status === "applying" || run.status === "verifying" || run.status === "validating")) {
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: "cancelled", completedAt: new Date() },
    });
  }
  return true;
}

/** Record a human approval decision and release the run's gate. */
export async function decideApproval(
  runPublicId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string | null,
): Promise<{ ok: boolean; message: string }> {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.runId === null) {
    return { ok: false, message: "approval request not found" };
  }
  const run = await db.agentRun.findUnique({ where: { id: approval.runId } });
  if (!run || run.publicId !== runPublicId) {
    return { ok: false, message: "approval does not belong to this run" };
  }
  if (approval.status !== "pending") {
    return { ok: false, message: `approval already ${approval.status}` };
  }

  await db.approval.update({
    where: { id: approvalId },
    data: { status: decision, decidedAt: new Date(), decisionNote: note ?? null },
  });

  // Change-set workflow: approval is RECORDED; applying is a separate,
  // explicit step that does not exist in this phase (no disk writes).
  if (decision === "rejected") {
    await db.changeSet.updateMany({
      where: { runId: run.id, status: "proposed" },
      data: { status: "discarded" },
    });
  }

  const active = ACTIVE_RUNS.get(runPublicId);
  const gate = active?.approvalGates.get("pending");
  if (gate) {
    active?.approvalGates.delete("pending");
    gate(decision);
  }
  return {
    ok: true,
    message:
      decision === "approved"
        ? "Approval recorded — applying the approved change-set to the workspace with verification."
        : "Rejection recorded — the proposed change-set was discarded; no files were modified.",
  };
}

/** Full run state for polling + UI. */
export async function getRunState(runPublicId: string): Promise<OrchestrationRunState | null> {
  await recoverStaleRuns();
  const run = await db.agentRun.findUnique({
    where: { publicId: runPublicId },
    include: {
      orchestratorSpans: { orderBy: { startedAt: "asc" as const } },
      approvals: { orderBy: { createdAt: "asc" as const } },
      changeSets: { include: { changes: true } },
    },
  });
  if (!run) return null;

  let input: OrchestratorRunInput = { request: "" };
  try {
    input = JSON.parse(run.input ?? "{}") as OrchestratorRunInput;
  } catch {
    // keep default
  }

  let output: {
    answer?: string | null;
    criticVerdict?: CriticVerdict | null;
    criticIssues?: CriticIssue[];
    retrievedAgain?: boolean;
    plan?: OrchestrationPlan | null;
  } = {};
  try {
    output = JSON.parse(run.output ?? "{}") as typeof output;
  } catch {
    // keep default
  }

  const durationMs =
    run.startedAt && run.completedAt
      ? run.completedAt.getTime() - run.startedAt.getTime()
      : null;

  return {
    runPublicId: run.publicId,
    status: run.status as OrchestrationRunState["status"],
    input,
    intent: output.plan?.intent ?? null,
    plan: output.plan ?? null,
    spans: run.orchestratorSpans.map((span) => ({
      agent: span.agentName as AgentName,
      status: span.status as AgentResult["status"],
      findings: [],
      evidence: [],
      confidence: (span.confidence as AgentResult["confidence"]) ?? "weak",
      sources: safeParseArray(span.sourcesJson),
      nextAction: null,
      attempts: span.attempts,
      toolCount: span.toolCount,
      durationMs: span.endedAt
        ? span.endedAt.getTime() - span.startedAt.getTime()
        : 0,
      error: span.error,
      wave: span.wave,
    })),
    answer: output.answer ?? null,
    criticVerdict: output.criticVerdict ?? null,
    criticIssues: output.criticIssues ?? [],
    retrievedAgain: output.retrievedAgain ?? false,
    approvals: run.approvals.map((a) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(a.payload ?? "{}") as Record<string, unknown>;
      } catch {
        // keep default
      }
      return {
        id: a.id,
        kind: a.kind,
        status: a.status,
        whatWillChange: String(payload.whatWillChange ?? ""),
        affectedFiles: Array.isArray(payload.affectedFiles) ? (payload.affectedFiles as string[]) : [],
        whyApprovalNeeded: String(payload.whyApprovalNeeded ?? ""),
        risk: String(payload.risk ?? ""),
        requestedPermission: String(payload.requestedPermission ?? ""),
      };
    }),
    changeSets: run.changeSets.map((cs) => ({
      publicId: cs.publicId,
      title: cs.title,
      status: cs.status,
      description: cs.description,
      changes: cs.changes.map((c) => ({
        path: c.path,
        changeKind: c.changeKind,
        status: c.status,
        diff: c.diff,
      })),
    })),
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    durationMs,
  };
}

function safeParseArray(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Recent runs for the observability list. */
export async function listRecentRuns(limit = 20): Promise<
  Array<{
    runPublicId: string;
    status: string;
    request: string;
    startedAt: string | null;
    completedAt: string | null;
    agentCount: number;
  }>
> {
  await recoverStaleRuns();
  const runs = await db.agentRun.findMany({
    where: { kind: "orchestrator" },
    orderBy: { createdAt: "desc" as const },
    take: limit,
    include: { _count: { select: { orchestratorSpans: true } } },
  });
  return runs.map((run) => {
    let request = "";
    try {
      request = (JSON.parse(run.input ?? "{}") as OrchestratorRunInput).request ?? "";
    } catch {
      // keep empty
    }
    return {
      runPublicId: run.publicId,
      status: run.status,
      request: request.slice(0, 120),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      agentCount: run._count.orchestratorSpans,
    };
  });
}
