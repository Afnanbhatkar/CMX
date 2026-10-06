# Agent Spec — Verifier (critic)

| Field | Value |
| --- | --- |
| **name** | `critic` |
| **goal** | Verify the reasoning answer against evidence: every file reference must really exist, every claim must cite real support, and an LLM cross-check flags unsupported/contradictory content. Weak evidence triggers ONE re-retrieval or an honest "could not be verified". |
| **tools** | `repo.read-file`, `repo.search` (re-retrieval), `repo.symbol-scan`. |
| **input schema** | `AgentCall`: `reasoning` (answer + claims), evidence digest from shared caches. |
| **state** | Emits verdict/issues consumed by the engine (re-retrieval loop + final answer composition); persisted as the critic span (metadata) and inside `AgentRun.output`. |
| **permission level** | `read-analyze-only`; `approvalPolicy: never`. |
| **stop conditions** | Deterministic reference verification completes even without the gateway; the LLM claim check is deadline-capped. Returns `completed` with an honest verdict; engine handles retries/cancel. |
| **failure modes** | No reasoning to verify → issue `missing-evidence`, verdict `unverified`. LLM cross-check unavailable → deterministic checks still cap the verdict (never upgraded without support). |
| **output schema** | `AgentResult` (findings: verdict + issue list; evidence). |
| **evidence requirements** | Issues carry real paths where applicable; verdicts are one of `supported` / `weak-evidence` / `unverified`. |
| **evaluation cases** | `critic-catches-wrong-reference`: a seeded answer referencing a phantom file MUST produce a `wrong-file-reference` issue and a non-`supported` verdict (deterministic — passes with or without gateway). |
| **spec source** | `agents.ts` (`runCritic`), `services/reference-verifier.ts`. |
