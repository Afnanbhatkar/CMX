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
> Never hide environmental limitations. Verified: Phase 0 governance addendum; updated Phase 3; updated Phase 4.

| Capability | Status | Evidence / Notes |
| --- | --- | --- |
| **PostgreSQL** | `unavailable` | No `psql`/server in sandbox. Prisma provider is `sqlite`. `/api/health` reports it `unavailable (planned)` — never healthy. Revisit only if the platform provides a host. |
| **SQLite fallback** | `production` | Active datastore: Prisma 6 + `db/custom.db` — **31 tables** (legacy `User`/`Post` preserved + 20 Phase 3 domain tables + 9 V2.1 tables: auth_sessions, repository_members, memory_items, memory_events, user_profiles, glossary, decision_records, usage_records, audit_logs). This is the real database — not a demo. |
| **Redis** | `unavailable` | No `redis-server`/`redis-cli`, no daemon on :6379. Use in-process memory caching (allowed by platform stack). |
| **Job queue (Redis-spec semantics)** | `local` | Phase 3: in-process queue + SQLite persistence (`analysis_jobs` + `analysis_checkpoints`), 6 spec states, pause/resume/cancel, checkpointed resume, restart-survival via recovery requeue (11-min staleness cutoff + conditional atomic requeue as of Phase 4). Redis-backed workers remain `unavailable`/[PLANNED]. |
| **Repository import (git/ZIP)** | `local` | Phase 4: `repository.import` job — GitHub/Git HTTPS/local/ZIP sources, refs, shallow+sparse clone, incremental fetch, resumable checkpoints (all spec §5 fields), isolated `.ingestion-workspaces/`, static-only (git is the only executed binary), cancel kills the git child. Verified live: local repo import → chained index → real snapshot; ZIP traversal rejected; 409/422/404 envelopes. |
| **OpenTelemetry tracing** | `local` | Phase 4 (V2.1 §B): `@opentelemetry/api` + `sdk-trace-base`, `http.request` spans on every API route, W3C traceparent propagation verified. In-memory ring buffer only — OTLP export `unavailable`/[PLANNED] (no collector in sandbox). |
| **Auth / sessions** | `local` | Phase 4 (V2.1 §A): provider abstraction + hash-only session lifecycle + role/repository authorization helpers; **unconfigured by default** — no route requires auth yet. OAuth/NextAuth flows [PLANNED]. |
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
| **Assistant image understanding** | `unavailable` | Phase 8.5: the chat transport's message contract is text-only (`GatewayMessage.content: string`) — no image parts. Measured by `GET /api/assistant/capabilities`; the composer image button is capability-gated with the honest reason. Flows (screenshot→diagnosis/proposal) activate when the transport gains image support. |
| **Streaming (SSE)** | `production` | Phase 3: typed event bus (`src/server/events`) + SSE at `/api/events` (+ `/api/events/stream`) and `/api/assistant/stream` — replay buffer, heartbeats, privacy-enforced event schemas (operational labels only, `.strict()` zod). Token-level assistant streaming awaits a gateway streaming API — no fake chunking is performed. WebSocket [PLANNED]. |
| **Editor inline AI (completion / Ctrl+K edit / Hinglish hover)** | `production` | Phase 8.75: Monaco inline completions + Cmd/Ctrl+K inline edit + Hinglish hover, all through LLMGateway. HONEST latency: the chat-model transport serves ghost text at **measured p50 ≈ 0.8–1.0 s** in this environment (window.__cmxInlineAI.stats()) — the 300 ms IDE-grade target is NOT met here and is NOT claimed; it activates only where the environment supports it. Cancellation/stale-guard make slow responses safe (obsolete completions are never inserted). |

## Degradation ladder (binding for future phases)

| Need | First choice | Fallback | If both missing |
| --- | --- | --- | --- |
| Vector search | Qdrant | local vector fallback | lexical search + say so in UI |
| Knowledge graph | Neo4j | in-process graph fallback | no graph features claimed |
| Cache/queue | Redis | in-memory (per-process, documented) | none — say so |
| Code execution sandbox | Docker | ephemeral process + limits + approval gate | capability disabled in UI |
| LLM | platform gateway (production) | none | features disabled, honestly |
