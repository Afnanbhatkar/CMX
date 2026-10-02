# CodeMind X V2 — Capability Registry

> Runtime support matrix for the **current sandbox environment**. Statuses describe
> *environmental support*, not feature completion — a phase must still implement
> and evaluate a capability before it may be advertised.
>
> Statuses: **production** (live, backed by real service) · **local** (runs
> in-process / on-demand in this environment) · **fallback** (degraded in-process
> substitute available or planned) · **unavailable** (no support; must not be used
> or claimed).
>
> Never hide environmental limitations. Verified: Phase 0 governance addendum.

| Capability | Status | Evidence / Notes |
| --- | --- | --- |
| **PostgreSQL** | `unavailable` | No `psql`/server in sandbox. Prisma provider is `sqlite`. Revisit only if platform provides a host. |
| **SQLite fallback** | `production` | Active datastore: Prisma 6 + `db/custom.db` (tables `User`, `Post`). This is the real database — not a demo. |
| **Redis** | `unavailable` | No `redis-server`/`redis-cli`, no daemon on :6379. Use in-process memory caching (allowed by platform stack). |
| **Qdrant** | `unavailable` | No service/binary. Vector search needs a local fallback (below) until a host exists. |
| **Local vector fallback** | `fallback` | Feasible in-process (Bun/TS): brute-force cosine index persisted in SQLite. Not yet implemented — owned by a retrieval phase. |
| **Neo4j** | `unavailable` | No service/binary. |
| **NetworkX-style graph fallback** | `fallback` | Feasible in-process TS adjacency/graph lib; no Python graph stack needed. Not yet implemented — owned by a graph phase. |
| **Docker / Compose** | `unavailable` | `docker`, `docker-compose` absent; no daemon. Do not write features requiring containers. |
| **Sandbox (code execution)** | `fallback` | No container isolation available. Ephemeral child processes with timeouts + resource limits are possible (Bun). Execution features must state the weaker isolation honestly and gate on approval. |
| **Playwright** | `local` | Binary present in environment; agent-browser provides headless verification today. Installable as npm dep for app-level E2E when a testing phase owns it. |
| **LSP servers** | `local` | TypeScript language tooling runs locally (`tsserver`/`typescript-language-server` installable via npm). Not installed yet — owned by an intelligence phase. |
| **WebGL** | `local` | Browser-GPU dependent; verified working in the preview browser (Phase 1 shader). Must always ship a non-WebGL fallback. |
| **Local LLM / Ollama** | `unavailable` | `ollama` absent, :11434 down. No local model serving. |
| **External LLM providers** | `production` | `z-ai-web-dev-sdk` platform gateway (LLM, VLM, embeddings, search, ASR/TTS, image/video). **Backend-only** — never imported client-side. |

## Degradation ladder (binding for future phases)

| Need | First choice | Fallback | If both missing |
| --- | --- | --- | --- |
| Vector search | Qdrant | local vector fallback | lexical search + say so in UI |
| Knowledge graph | Neo4j | in-process graph fallback | no graph features claimed |
| Cache/queue | Redis | in-memory (per-process, documented) | none — say so |
| Code execution sandbox | Docker | ephemeral process + limits + approval gate | capability disabled in UI |
| LLM | platform gateway (production) | none | features disabled, honestly |
