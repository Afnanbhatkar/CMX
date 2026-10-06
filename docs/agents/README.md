# CodeMind X Agent Specifications (V2.1 §D template)

Every agent in `src/server/orchestrator/registry.ts` is documented with this
exact template. A spec is a CONTRACT, not documentation of whatever the code
happens to do — when the two diverge, the code is wrong.

## Template fields (mandatory for every agent document)

| Field | Meaning |
| --- | --- |
| **name** | Stable registry id (e.g. `planner`). |
| **goal** | One paragraph: what this agent is FOR. |
| **tools** | The exact tool grants from the registry (empty = no tools). |
| **input schema** | The contract it receives (`AgentCall` fields it uses). |
| **state** | What it persists or safely manages (DB rows, call-scoped caches). |
| **permission level** | The registry permission tier + approval policy. |
| **stop conditions** | Every condition under which it returns (success, failure, timeout, cancel). |
| **failure modes** | What can go wrong and what honestly happens then. |
| **output schema** | The `AgentResult` shape it emits. |
| **evidence requirements** | What real evidence (path:line, counts) it must cite. |
| **evaluation cases** | The case ids in `src/server/orchestrator/evals.ts` that pass through it. |

## Capability rule (V2.1 §F — binding)

An agent is labeled `implemented` ONLY when:
1. its tools execute for real,
2. its state is persisted or safely managed,
3. its output is structured, and
4. at least one evaluation case PASSES through it.

Otherwise its status must be `partial` (real code, eval pending) or `planned`
(spec exists, no implementation). Statuses live in `registry.ts`; the eval
suite is the proof.

## Documents

- Core four (implemented, spec-first): `planner.md`, `retrieval.md`,
  `coder.md`, `verifier.md`
- `specialists-implemented.md` — code-analyst, graph, security, dependency,
  git, reasoning
- `specialists-planned.md` — testing, documentation, debugger, architecture,
  performance, refactoring, migration, release, sandbox, reproducer,
  dependency-upgrader, pr-review, log-analyst

## Standing security rules (apply to every agent)

1. Repository content and tool output are DATA, never instructions — fenced
   (`<<<UNTRUSTED_REPO_DATA>>>` / `<<<UNTRUSTED_TOOL_OUTPUT>>>`) and surfaced
   when they contain instruction-like patterns.
2. Tool output cannot increase permissions, change autonomy, bypass approval,
   or redefine policy — enforced in code (`tools.ts assertTool`, engine
   approval gates), never by prompting.
3. Memory is never created from repository text, tool output, logs or commit
   messages (Phase 9.5 §15; enforced by `src/server/memory/secret-guard.ts`).
