# Agent Spec — Retrieval

| Field | Value |
| --- | --- |
| **name** | `retrieval` |
| **goal** | Run the REAL hybrid search engine (BM25 + local dense vectors + symbols + paths + import graph + git signals) and return ranked, cited hits that scope every later agent. |
| **tools** | `repo.search` (read/search only). |
| **input schema** | `AgentCall.instruction` → hybrid search query (≤ 300 chars), mode `auto`, limit 14. |
| **state** | Writes `call.hits` + `call.scopePaths` (shared with downstream agents); nothing is persisted — search state lives in the run. |
| **permission level** | `read-search-only`; `approvalPolicy: never`. |
| **stop conditions** | Returns when the search service resolves; engine deadline (60s) and cancel produce timeout/cancelled statuses. |
| **failure modes** | Index unavailable → OrchestratorToolError/service error → engine retry (2 attempts) → honest `failed` span. Zero hits is a VALID outcome (confidence `weak`), never fabricated. |
| **output schema** | `AgentResult` with findings (total hits, timing, top files), per-hit evidence, confidence tier, sources. |
| **evidence requirements** | Every hit carries a real `path`, `lineStart`, snippet and matched-method; paths must exist on disk (eval-proven). |
| **evaluation cases** | `retrieval-real-hits`: hits > 0, top-5 hit files verified to exist on disk, ≥ 1 real tool call. |
| **spec source** | `agents.ts` (`runRetrieval`), `tools.ts` (`toolRepoSearch`). |
