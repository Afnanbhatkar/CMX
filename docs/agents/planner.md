# Agent Spec — Planner

| Field | Value |
| --- | --- |
| **name** | `planner` |
| **goal** | Classify the request intent (question / search / architecture / security / coding / multi-agent) and produce the MINIMAL agent plan — which implemented agents run, in which order, with per-step instructions. Never instantiates every agent. |
| **tools** | None (LLM-backed with a deterministic heuristic fallback). |
| **input schema** | `AgentCall`: `request` (fenced as untrusted data before any prompt). |
| **state** | The produced `OrchestrationPlan` is written to `call.plan` and persisted inside `AgentRun.output` by the engine — safely managed, no side effects of its own. |
| **permission level** | `approvalPolicy: never`; no tool grants. |
| **stop conditions** | Returns after ONE structured model completion (deadline-capped at min(timeout, 55s)) or the deterministic fallback on any model failure; aborted runs return `cancelled` from the engine. |
| **failure modes** | Model unavailable/429/unparseable → heuristic fallback plan (confidence `probable`, honestly labeled). Malformed step graphs → `normalizePlan` caps at 8 steps, re-ids, drops unknown/self dependencies. |
| **output schema** | `AgentResult` (findings = intent + plan summary; structured plan carried on `call.plan`). |
| **evidence requirements** | The plan references only registry agents; instructions quote the user request verbatim. |
| **evaluation cases** | `planner-contract` (evals.ts): status completed, plan non-empty, intent vocabulary valid, agents known, dependencies acyclic, ≤ 8 steps. |
| **spec source** | `src/server/orchestrator/agents.ts` (`runPlanner`), `registry.ts`. |
