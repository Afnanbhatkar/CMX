# Agent Specs — implemented specialists + synthesis agents

All fields follow `docs/agents/README.md` (V2.1 §D template). Source of truth:
`src/server/orchestrator/registry.ts` + `agents.ts`. Every one has a passing
evaluation case in `src/server/orchestrator/evals.ts` (capability rule §F).

## Reasoning (`reasoning`)

- **goal**: synthesize the final answer from gathered evidence ONLY; cite real
  paths; say explicitly what the evidence does not cover.
- **tools**: none (LLM-backed, all inputs fenced as untrusted data).
- **input**: `AgentCall.request` + evidence digest (search hits + file
  structures from the shared cache).
- **state**: writes `call.reasoning` ({answer, claims}) consumed by the critic.
- **permission**: `read-analyze-only`, approval never.
- **stop conditions / failure modes**: one deadline-capped completion;
  unparseable/absent model output → `failed` span (honest, retry per registry).
- **output**: `AgentResult`; structured answer + verifiable claims.
- **evidence**: claims must carry support paths; answer must cite real `src/`
  paths when evidence exists.
- **evals**: `reasoning-grounded` (real retrieval → real gateway answer with
  claims; fails honestly if the gateway is unavailable).

## Code Analyst (`code-analyst`)

- **goal**: read the files retrieval surfaced and extract real structural facts
  (lines, top-level exports, key symbols).
- **tools**: `repo.read-file`, `repo.read-tree`, `repo.symbol-scan`.
- **state**: fills the shared `call.fileCache`; persists nothing.
- **permission**: `read-analyze-only`, approval never.
- **stop/failure**: unreadable files become honest "unreadable" findings;
  abort checked per file.
- **evals**: `analyst-structure` (reads `engine.ts` through its granted tool).

## Graph (`graph`)

- **goal**: build the REAL import graph for the scope: edges, fan-in hubs,
  import cycles, unresolved aliases.
- **tools**: `graph.import-graph`, `repo.read-file`, `repo.read-tree`.
- **state**: none persisted (pure analysis of real files).
- **permission**: `read-analyze-only`, approval never.
- **stop/failure**: capped at 120 files when no scope is provided; honest
  `weak` confidence on empty graphs.
- **evals**: `graph-real-edges` (real edge findings over orchestrator files).

## Security (`security`)

- **goal**: static pattern scan (secrets, injection sinks, unsafe APIs) with
  path:line evidence — honestly labeled pattern-based, NOT a taint/SAST engine.
- **tools**: `static.security-scan`, `repo.read-file`, `repo.read-tree`.
- **permission**: `read-static-analysis-only`, approval never.
- **stop/failure**: zero findings is valid; scan coverage reported honestly.
- **evals**: `security-scan-real` (real scan over `src/server/memory`).

## Dependency (`dependency`)

- **goal**: cross-check declared package.json dependencies against actual
  import usage across the workspace.
- **tools**: `deps.scan`, `repo.read-file`, `repo.read-tree`.
- **permission**: `read-analyze-only`, approval never.
- **stop/failure**: malformed package.json → honest findings; zero mismatch is
  a valid result ("no declared/used mismatches found").
- **evals**: `dependency-declared-vs-used` (real declared set incl. `next`).

## Git (`git`)

- **goal**: read-only git intelligence — current branch, overview, recent
  commits. Mutating git operations are NOT implemented this phase.
- **tools**: `git.read-overview`, `git.read-commits`. `git.mutate` is granted
  to NO ONE.
- **permission**: `read-search-only`, approval never.
- **stop/failure**: git unavailable → honest "(unavailable)" findings.
- **evals**: `git-read-only` (real branch read through the granted tool).
