# CodeMind X V2 — Architecture

> **Status: Phase 0 (Foundation) complete.**
> This document describes the **target** system. It intentionally does **not** claim
> that future capabilities are already implemented. Capabilities marked
> **[PLANNED]** must not be advertised as working anywhere in the product until the
> phase that owns them has delivered real, evaluated implementations.

---

## 1. What CodeMind X V2 Is

CodeMind X V2 is an AI-powered software engineering platform — not a generic chatbot
dashboard. The final system is intended to:

- Understand real software repositories
- Search and analyze repository architecture
- Answer engineering questions with grounded context
- Propose code changes as reviewable diffs
- Execute approved code inside a sandbox
- Run tests and perform security analysis
- Understand Git history
- Support controlled, human-approved autonomous coding workflows

Every one of the bullets above is **[PLANNED]** except the base application shell
delivered by the existing scaffold.

---

## 2. Runtime Reality vs. Target Architecture

**Preservation rule (V2.1):** existing technology is preserved when reasonable.

The current runtime is a **Next.js 16 fullstack application** (App Router,
TypeScript 5, React 19, Tailwind CSS 4, shadcn/ui, Prisma + SQLite, Bun toolchain).
This is the preserved baseline and the primary implementation vehicle.

The original target specification lists a Python/FastAPI backend with
PostgreSQL/Redis/Qdrant/Neo4j. Those remain **[PLANNED]** deployment options for
heavyweight intelligence services. They are **not installed** in Phase 0 — nothing
is installed blindly. When a later phase genuinely requires a separate service
(e.g. a Python analysis worker), it will be added under the `mini-services/`
boundary, which already supports independent services behind the sandbox gateway.

| Layer | Now (Phase 0) | Planned vehicle |
| --- | --- | --- |
| Presentation | Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui | Same, plus Framer Motion, Monaco, React Flow, Three.js/R3F when owned by a UI phase |
| Application/API | Next.js Route Handlers (`src/app/api/**`) | Same + typed service layer |
| AI Control Plane | — [PLANNED] | LLM orchestration via backend SDK |
| Agent Orchestrator | — [PLANNED] | Multi-agent orchestration, tool calling, evaluation |
| Tool Runtime | — [PLANNED] | Sandboxed execution, test runner adapters |
| Repository Intelligence | — [PLANNED] | Git, GitHub API, Tree-sitter |
| Search / AST / Graph | — [PLANNED] | Hybrid retrieval, embeddings, RAG, knowledge graph |
| Data | Prisma 6 + SQLite (`db/custom.db`) | PostgreSQL, Redis, Qdrant, Neo4j when owned by a data phase |

---

## 3. Target Layering

```
Presentation
    ↓
Application/API
    ↓
AI Control Plane
    ↓
Agent Orchestrator
    ↓
Tool Runtime
    ↓
Repository Intelligence
    ↓
Search / AST / Graph / Git
    ↓
PostgreSQL / Qdrant / Neo4j / Redis
```

Each layer may only call the layer directly beneath it. Presentation never talks to
the Tool Runtime or the database directly.

---

## 4. AI Request Flow [PLANNED]

```
User Request
    ↓
Language / Intent Understanding
    ↓
Task Planning
    ↓
Repository Context
    ↓
Hybrid Retrieval
    ↓
Graph Context
    ↓
Specialized Agent Selection
    ↓
Tool Execution
    ↓
Validation / Critic
    ↓
Response or Proposed Change
```

## 5. Code-Change Flow [PLANNED]

```
Request
    ↓
Inspect
    ↓
Plan
    ↓
Generate Patch
    ↓
Diff
    ↓
User Approval          ← hard human gate; nothing applies without approval
    ↓
Sandbox
    ↓
Tests
    ↓
Build
    ↓
Security Scan
    ↓
Final Review
    ↓
Apply
```

---

## 6. Core Domain Boundaries

Logical boundaries exist as directory skeletons. They contain **no fake runtime
code** — only contracts (types) and placeholder `.gitkeep` files. Heavy
capabilities are implemented only by the phase that owns them.

### 6.1 Frontend (`src/`)

| Directory | Purpose | Status |
| --- | --- | --- |
| `src/app/` | Next.js App Router: routes, layouts, route handlers | Active (scaffold) |
| `src/components/` | Shared UI; `src/components/ui/` holds the shadcn/ui set | Active (scaffold) |
| `src/features/` | Feature modules (chat, repo explorer, diff review, …) | Skeleton |
| `src/hooks/` | Shared React hooks | Active (scaffold) |
| `src/lib/` | Framework-agnostic utilities; DB client lives in `src/lib/db.ts` | Active (scaffold) |
| `src/services/` | Typed frontend API clients (fetch wrappers) | Skeleton |
| `src/stores/` | Client state (Zustand) | Skeleton |
| `src/types/` | Cross-cutting TypeScript contracts (see `src/types/contracts.ts`) | Active (Phase 0) |

### 6.2 Server / Backend (`src/server/`)

Next.js keeps HTTP route handlers in `src/app/api/**` by convention. Server-side
domain logic lives under `src/server/` and is consumed by those handlers.

| Directory | Purpose | Status |
| --- | --- | --- |
| `src/server/api/` | API support modules (handler composition, shared response helpers). HTTP handlers themselves live in `src/app/api/` | Skeleton |
| `src/server/models/` | Data model code. **Source of truth for the schema is `/prisma/schema.prisma`**; the client is exposed via `src/lib/db.ts` | Skeleton + Prisma |
| `src/server/schemas/` | Validation schemas (Zod) for API I/O | Skeleton |
| `src/server/services/` | Domain services (business logic) | Skeleton |
| `src/server/repositories/` | Data access layer over the DB client | Skeleton |
| `src/server/agents/` | Agent definitions and orchestration [PLANNED] | Skeleton |
| `src/server/search/` | Hybrid retrieval / embeddings / RAG [PLANNED] | Skeleton |
| `src/server/graph/` | Knowledge graph context [PLANNED] | Skeleton |
| `src/server/execution/` | Sandbox / tool runtime [PLANNED] | Skeleton |
| `src/server/security/` | Security analysis [PLANNED] | Skeleton |
| `src/server/testing/` | Test orchestration [PLANNED] | Skeleton |
| `src/server/git/` | Git intelligence [PLANNED] | Skeleton |
| `src/server/jobs/` | Background job definitions [PLANNED] | Skeleton |

### 6.3 Other boundaries

- `examples/` — reference demos (websocket service) that ship with the scaffold.
- `mini-services/` — independent side services (own port, own package.json) for
  capabilities that must not live inside the Next.js process.
- `tests/` — environment/runtime verification scripts (scaffold-provided).
- `prisma/` — database schema source of truth.
- `db/` — SQLite runtime artifacts (ignored by Git; see PROJECT_SAFETY.md).

**Rule:** no huge monolithic files. Each domain owns small, single-purpose modules.

---

## 7. Reference Implementation Contract

Supplied HTML/CSS/JS references are **design specifications**, not paste-in assets.
When a reference is provided to a later phase, that phase must:

1. Read it completely
2. Identify structure, animation, timing, interaction, and state
3. Reconstruct it natively in React/TypeScript (no standalone HTML pasted into the app)
4. Preserve important UX behavior
5. Isolate it as its own component with typed props
6. Not rewrite unrelated components; later modifications target that specific component
7. Preserve its public contract unless there is a strong architectural reason

Independently replaceable components (each must be its own file, swappable without
touching siblings):

- `ThinkingOrb.tsx`
- `ThoughtChain.tsx`
- `LatticeLoader.tsx`
- `ApprovalCard.tsx`
- `AuroraText.tsx`
- `DiaTextReveal.tsx`

---

## 8. Activity / Thinking Privacy Contract

The UI shows user-visible **execution activity**. It must never expose private
model chain-of-thought.

**Allowed (system-activity statements):**

- Understanding request
- Searching repository
- Reading files
- Checking dependencies
- Planning changes
- Running tests
- Performing security analysis
- Preparing diff

**Not allowed:**

- Hidden internal reasoning
- Private chain-of-thought / deliberation tokens
- Secret prompts
- Hidden model reasoning

The UI communicates **what the system is doing**, never private reasoning. The
`ActivityKind` contract in `src/types/contracts.ts` is the closed vocabulary for
such activity events.

---

## 9. Typed Contracts

`src/types/contracts.ts` defines infrastructure-level contracts:

- `PhaseStatus`, `AgentStatus`, `ActivityKind`
- `ActivityEvent` — the shape of a user-visible activity item (privacy contract §8)
- `PhaseInfo` — phase metadata for status surfaces

These are types only. No runtime behavior is faked in Phase 0.

---

## 10. Infrastructure Notes (sandbox)

- Single external port; a Caddy gateway (`Caddyfile`) routes `/` → Next.js on port
  3000 and `?XTransformPort=<port>` → auxiliary services.
- Internal service-to-service calls must use **relative URLs** with the
  `XTransformPort` query parameter; absolute localhost URLs with ports are
  prohibited in application code.
- Real-time features must use socket.io/WebSocket via the gateway (see
  `examples/websocket/`).
- Dev server: `bun run dev` on port 3000; logs stream to `dev.log`.

---

## 11. Non-Goals of Phase 0

Phase 0 deliberately does **not** implement: repository ingestion, search, agents,
sandbox execution, diffs, security scanning, or any AI behavior. No capability is
"implemented" unless real tools, real execution, and at least one evaluation case
exist for it.
