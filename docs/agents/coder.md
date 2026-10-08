# Agent Spec — Coder (coding)

| Field | Value |
| --- | --- |
| **name** | `coding` |
| **goal** | Propose MINIMAL change-sets (per-file diffs) for a coding request. PROPOSE ONLY — nothing is ever written to disk in this phase; application requires the change-set workflow + explicit human approval. |
| **tools** | `repo.read-file`, `repo.search` (grounding), `code.propose-changes` (records the proposal). `code.apply-changes` is granted to NO ONE. |
| **input schema** | `AgentCall`: request (fenced), instruction, scope paths (from retrieval or its own search), `runInternalId` for persistence. |
| **state** | PERSISTS: `ChangeSet` (status `proposed`) + `CodeChange` rows (status `proposed`) + `Approval` (status `pending`, 15-minute honest expiry owned by the engine). Disk is NEVER touched. |
| **permission level** | `read-propose-only`; `approvalPolicy: on-mutating-action`. |
| **stop conditions** | Structured proposal parsed → persist → `awaiting-approval`. Model unavailable/unparseable → `failed` (engine may retry ×2). All proposed paths invalid → `failed` ("proposal targets no real files"). |
| **failure modes** | Non-existent modify/delete targets are dropped; if nothing valid remains the agent fails honestly. Gateway outage → failed span, no fabricated diffs. |
| **output schema** | `AgentResult` (findings: change-set title, affected files, approval status; evidence: diff snippets). |
| **evidence requirements** | modify/delete proposals must reference real files (verified through `repo.read-file` before persisting). |
| **evaluation cases** | `coding-propose-only-persists`: status `awaiting-approval`, ChangeSet persisted `proposed`, Approval `pending`, disk byte-identical before/after. |
| **spec source** | `agents.ts` (`runCoding`), `registry.ts`. |
