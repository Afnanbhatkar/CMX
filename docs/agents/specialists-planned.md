# Agent Specs — planned specialists (V2.1 §E preparations)

Status: **`planned`** for every agent below (capability rule §F: no real tools
and no passing evaluation case yet). They are declared in the registry so every
agent has a spec, they are NEVER instantiated for tasks (the planner plans only
implemented agents) and NEVER silently executed (the dispatcher returns an
honest `skipped` and the engine filters non-implemented agents).

V2.1 §E list from the user directive — all present:

| name | label | goal (when implemented) | approval |
| --- | --- | --- | --- |
| `reproducer` | Reproducer Agent | turn a bug report into a minimal failing reproduction before any fix | on-mutating-action |
| `dependency-upgrader` | Dependency Upgrader | safe upgrade plans with breaking-change analysis + rollback notes via change-sets | on-mutating-action |
| `performance` | Performance Agent | measured hot-path analysis (never speculative) | never |
| `pr-review` | PR Review Agent | structured PR review: correctness, style-drift vs project rules, risk | never |
| `log-analyst` | Log Analyst | correlate runtime logs with code paths; logs are untrusted data | never |
| `migration` | Migration Agent | framework/migration planning | on-mutating-action |
| `architecture` | Architecture Agent | boundary/drift intelligence beyond the core graph agent | never |
| `security`* | Security Agent | (IMPLEMENTED — see specialists-implemented.md) | never |
| `testing` | Testing Agent | run affected tests, report coverage/regression risk | on-mutating-action |
| `documentation` | Documentation Agent | draft/update documentation with citations | never |
| `git`* | Git Agent | (IMPLEMENTED — read-only) | never |
| `debugger` | Debugger Agent | reproduce, isolate and explain failures | never |
| `refactoring` | Refactoring Agent | safe refactor proposals via change-sets | on-mutating-action |
| `release` | Release Agent | release notes/checklists with approvals | on-mutating-action |

\* shipped in an earlier phase.

## Promotion rule (how a planned agent becomes `partial` → `implemented`)

1. Implement real tools behind the code-enforced permission layer.
2. Define the agent's state (persisted or safely managed).
3. Emit the structured `AgentResult` contract.
4. Add ≥ 1 evaluation case to `src/server/orchestrator/evals.ts`.
5. When that case PASSES through the real agent, the registry status may move.
   Until then the status stays `planned` — never "implemented by assumption".

"Do not instantiate all of them for every task" is enforced twice: the planner
prompt says MINIMAL plans and lists only implemented agents, and the engine
filters every non-implemented step out of plans before execution.
