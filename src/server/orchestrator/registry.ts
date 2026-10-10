/**
 * CodeMind X V2 — Phase 9 agent registry.
 *
 * The single source of truth for every agent's CONTRACT (spec §3):
 * name, version, capability status, input/output schema names, allowed
 * tools, timeout, approval policy and retry policy.
 *
 * Honesty rule (RULES.md §9 + Phase 9 V2.1 capability rule): an agent is
 * `implemented` only when it runs REAL tools, persists REAL state, emits the
 * structured output contract and is exercised by the acceptance scenarios.
 * Everything else is declared `planned` and is never silently executed.
 */

import {
  AGENT_NAMES,
  type AgentCapabilityStatus,
  type AgentName,
  type ToolGrant,
  type ToolName,
  type ToolPermissionTier,
} from "./contracts";

export interface AgentSpec {
  name: AgentName;
  label: string;
  version: string;
  status: AgentCapabilityStatus;
  tier: "core" | "specialist";
  description: string;
  /** Input contract name (see contracts.ts — every agent takes AgentCall). */
  inputSchema: "AgentCall";
  /** Output contract name — every implemented agent returns AgentResult. */
  outputSchema: "AgentResult";
  allowedTools: ToolGrant[];
  timeoutMs: number;
  /** "never" = the agent cannot mutate anything; "on-mutating-action" = the */
  /** engine pauses for a human decision before the recorded action proceeds. */
  approvalPolicy: "never" | "on-mutating-action";
  retry: { maxAttempts: number; backoffMs: number };
}

function grants(...tools: Array<[ToolName, string]>): ToolGrant[] {
  return tools.map(([tool, reason]) => ({ tool, reason }));
}

/** Implemented agents — REAL tools, REAL state, REAL structured output. */
export const AGENT_SPECS: Record<AgentName, AgentSpec> = {
  planner: {
    name: "planner",
    label: "Planner",
    version: "1.0.0",
    status: "implemented",
    tier: "core",
    description:
      "Classifies the request intent and produces the agent plan (which agents run, in which order). LLM-backed with a deterministic fallback.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    // 40s ceiling, single attempt (measured Phase 9.6 fix): the chat run
    // surface's SSE connection is killed by the network path at ~3.5min
    // (dev.log "client disconnect" at 3m11s–3m29s on every long run), so
    // the WHOLE run must fit well under it. A stuck planner generation
    // previously blocked 90s × 2 engine attempts before the fallback —
    // the exact "Planning changes comes after so long secs" stall. Now the
    // planner is capped at ~35s of generation, after which the instant
    // deterministic fallback plan keeps the run moving.
    timeoutMs: 40_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 800 },
  },
  retrieval: {
    name: "retrieval",
    label: "Retrieval",
    version: "1.1.0",
    status: "implemented",
    tier: "core",
    description:
      "Full-repo file awareness: resolves path-like file mentions DIRECTLY against the real workspace tree (every text language — py/css/html/…) and reads them through the real file tool, on top of the real hybrid search engine (BM25 + vectors + symbols + paths + import graph + git). Missing files become honest negatives backed by the real tree inventory (closest existing files).",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["repo.search", "read/search only (spec §4)"],
      ["repo.read-tree", "workspace tree listing for direct file resolution (spec §4)"],
      ["repo.read-file", "read-only file access for direct file lookups (spec §4)"],
    ),
    // Local hybrid search + cached tree build + a few direct reads — 15s is
    // generous (measured sub-second typical).
    timeoutMs: 15_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 500 },
  },
  "code-analyst": {
    name: "code-analyst",
    label: "Code Analyst",
    version: "1.0.0",
    status: "implemented",
    tier: "core",
    description:
      "Reads the files retrieval surfaced and extracts real structural facts (languages, sizes, exports, key symbols). Read/analyze only.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["repo.read-file", "read-only file access (spec §4)"],
      ["repo.read-tree", "workspace tree listing (spec §4)"],
      ["repo.symbol-scan", "regex symbol scan (spec §4)"],
    ),
    // Local file reads + regex scans — no model in the loop.
    timeoutMs: 20_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  graph: {
    name: "graph",
    label: "Graph Agent",
    version: "1.0.0",
    status: "implemented",
    tier: "core",
    description:
      "Builds the real import graph for the files in scope and reports edges, hub files and cycles.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["graph.import-graph", "import graph over scoped files (spec §4)"],
      ["repo.read-file", "read-only file access (spec §4)"],
      ["repo.read-tree", "workspace tree listing (spec §4)"],
    ),
    timeoutMs: 20_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  reasoning: {
    name: "reasoning",
    label: "Reasoning Agent",
    version: "1.0.0",
    status: "implemented",
    tier: "core",
    description:
      "Synthesizes the final answer from gathered evidence only. Repository content enters its prompt as FENCED UNTRUSTED DATA.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    // 50s ceiling, single attempt: the final answer generation fits (the
    // gateway completes long-but-legitimate answers inside this budget),
    // while the run's total stays under the ~3.5min connection kill window.
    timeoutMs: 50_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 800 },
  },
  critic: {
    name: "critic",
    label: "Critic",
    version: "1.0.0",
    status: "implemented",
    tier: "core",
    description:
      "Verifies claims against evidence: file references through the real reference verifier, claim support through a fenced LLM check. Weak evidence triggers one re-retrieval or an honest 'could not be verified'.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["repo.read-file", "read-only file access (spec §4)"],
      ["repo.search", "re-retrieval on weak evidence (spec §7)"],
      ["repo.symbol-scan", "symbol existence checks (spec §4)"],
    ),
    // 35s ceiling, single attempt: verification is a bounded JSON check;
    // the weak-evidence re-round guard in the engine relies on this cap.
    timeoutMs: 35_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 800 },
  },
  security: {
    name: "security",
    label: "Security Agent",
    version: "1.0.0",
    status: "implemented",
    tier: "specialist",
    description:
      "Static pattern scan over scoped files (secrets, injection sinks, unsafe APIs). Read/static-analysis only — honest about pattern-based limits.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["static.security-scan", "pattern-based static analysis (spec §4)"],
      ["repo.read-file", "read-only file access (spec §4)"],
      ["repo.read-tree", "workspace tree listing (spec §4)"],
    ),
    timeoutMs: 25_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  dependency: {
    name: "dependency",
    label: "Dependency Agent",
    version: "1.0.0",
    status: "implemented",
    tier: "specialist",
    description:
      "Reads the real package.json and cross-checks declared dependencies against actual import usage across the workspace.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["deps.scan", "declared-vs-used dependency scan (spec §4)"],
      ["repo.read-file", "read-only file access (spec §4)"],
      ["repo.read-tree", "workspace tree listing (spec §4)"],
    ),
    timeoutMs: 20_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  git: {
    name: "git",
    label: "Git Agent",
    version: "1.0.0",
    status: "implemented",
    tier: "specialist",
    description:
      "Read-only git intelligence: current branch, overview and recent commits via the read-only git service. Mutating git operations are NOT implemented in this phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["git.read-overview", "branch/overview read (spec §4)"],
      ["git.read-commits", "recent commit history read (spec §4)"],
    ),
    timeoutMs: 12_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  coding: {
    name: "coding",
    label: "Coding Agent",
    version: "1.0.0",
    status: "implemented",
    tier: "specialist",
    description:
      "Proposes change-sets (per-file diffs) for the requested task. Proposals are PERSISTED as ChangeSet/CodeChange rows in 'proposed' status and REQUIRE the change-set workflow + explicit human approval. Nothing is ever written to disk by this phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: grants(
      ["repo.read-file", "read-only file access (spec §4)"],
      ["repo.search", "read/search to ground the proposal (spec §4)"],
      ["code.propose-changes", "record a proposed change-set (spec §4)"],
    ),
    // 60s ceiling, single attempt (was 120s × 2 engine attempts): a hung
    // proposal generation previously pinned the "Writing patch" row for up
    // to 4 minutes — the "stuck ongoing code writing" report — and the run
    // died with the connection. A capped single generation + honest failed
    // row keeps the run inside the kill window.
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 800 },
  },

  /* ---------------- specialists: honestly planned ---------------- */

  testing: {
    name: "testing",
    label: "Testing Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned: run affected tests and report coverage/regression risk. Arrives in a later phase — never silently executed.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  documentation: {
    name: "documentation",
    label: "Documentation Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description: "Planned: draft/update documentation with citations. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  debugger: {
    name: "debugger",
    label: "Debugger Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description: "Planned: reproduce, isolate and explain failures. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  architecture: {
    name: "architecture",
    label: "Architecture Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned: boundary/drift intelligence beyond the implemented import graph (the core graph agent already covers real import edges). Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  performance: {
    name: "performance",
    label: "Performance Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description: "Planned: measured hot-path analysis. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  refactoring: {
    name: "refactoring",
    label: "Refactoring Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description: "Planned: safe refactor proposals via change-sets. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  migration: {
    name: "migration",
    label: "Migration Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description: "Planned: framework/migration planning. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  release: {
    name: "release",
    label: "Release Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description: "Planned: release notes/checklists with approvals. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  sandbox: {
    name: "sandbox",
    label: "Sandbox Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned: isolated execution only. No execution sandbox exists in this phase — declared honestly, never invoked.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },

  /* ------- Phase 9.5 (V2.1 §E): specialists prepared as planned specs ------- */
  /* Each has the full spec template (docs/agents/) but NO real tools and NO */
  /* passing eval case yet — so the capability rule (§F) keeps them planned. */
  /* The planner never instantiates them (it plans only implemented agents). */

  reproducer: {
    name: "reproducer",
    label: "Reproducer Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned (Phase 9.5 preparation): turn a bug report into a minimal failing reproduction before any fix is proposed. Arrives with real execution tooling in a later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  "dependency-upgrader": {
    name: "dependency-upgrader",
    label: "Dependency Upgrader",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned (Phase 9.5 preparation): safe dependency upgrade plans with breaking-change analysis and rollback notes via change-sets. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "on-mutating-action",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  "pr-review": {
    name: "pr-review",
    label: "PR Review Agent",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned (Phase 9.5 preparation): structured pull-request review (correctness, style-drift vs project rules, risk) grounded in repository evidence. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
  "log-analyst": {
    name: "log-analyst",
    label: "Log Analyst",
    version: "0.0.0",
    status: "planned",
    tier: "specialist",
    description:
      "Planned (Phase 9.5 preparation): correlate runtime logs with code paths and propose hypotheses. Logs are untrusted data — same fencing as all tool output. Later phase.",
    inputSchema: "AgentCall",
    outputSchema: "AgentResult",
    allowedTools: [],
    timeoutMs: 60_000,
    approvalPolicy: "never",
    retry: { maxAttempts: 1, backoffMs: 0 },
  },
};

/** All agents the registry knows (guards against typos in plans). */
export function isKnownAgent(name: string): name is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(name);
}

/** Agents that can actually execute in this phase. */
export function implementedAgents(): AgentSpec[] {
  return AGENT_NAMES.map((n) => AGENT_SPECS[n]).filter(
    (s) => s.status === "implemented",
  );
}

/** Tool grants for an agent (empty for planned agents). */
export function allowedToolsFor(agent: AgentName): Set<ToolName> {
  return new Set(AGENT_SPECS[agent].allowedTools.map((g) => g.tool));
}

/** Permission tier label for the registry UI. */
export function permissionTierFor(agent: AgentName): ToolPermissionTier | null {
  const tierByAgent: Partial<Record<AgentName, ToolPermissionTier>> = {
    retrieval: "read-analyze-only",
    "code-analyst": "read-analyze-only",
    graph: "read-analyze-only",
    reasoning: "read-analyze-only",
    critic: "read-analyze-only",
    security: "read-static-analysis-only",
    dependency: "read-analyze-only",
    git: "read-search-only",
    coding: "read-propose-only",
  };
  return tierByAgent[agent] ?? null;
}
