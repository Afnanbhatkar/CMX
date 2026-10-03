# CodeMind X V2 — Project Safety Document

> Living document. Every phase must re-verify and update this file.
> Last updated: Phase 3 (Backend, API, Database, Jobs, Streaming Infrastructure).

---

## 1. Current Project State

- Fresh Next.js 16 scaffold (Z.ai Code baseline, package `nextjs_tailwind_shadcn_ts` v0.2.1)
  being transformed into **CodeMind X V2**.
- **Phases 0–3 implemented** (foundation; governance; design system + website;
  workspace shell; backend/API/database/jobs/streaming infrastructure).
- The application is runnable: dev server on port 3000, `/` renders, `/app`
  renders the four-panel workspace, `/api/health` reports real dependency state.
- No destructive operations were performed. Existing `User`/`Post` models and
  data survived every schema change (additive `prisma db push` only).

## 2. Git State

| Item | Value |
| --- | --- |
| Repository | `/home/z/my-project`, branch `main` |
| Baseline commit | `247ec7d` — "Initial commit" (contained only `.env`, `.gitignore`, `download/README.md`) |
| Phase 0 checkpoint | tag **`codemind-v2/phase-00-foundation`** (annotated; resolve via `git rev-parse codemind-v2/phase-00-foundation`) |
| Push policy | **Never push automatically.** |
| Forbidden commands | `git reset --hard`, `git clean -fd`, force push, history rewrite |

Notes:
- The baseline commit tracked `.env` (contains only `DATABASE_URL`, non-secret).
- Before Phase 0, the entire working tree (`src/`, configs, prisma, examples, …)
  was **untracked**. Phase 0 captured it into the checkpoint commit so future
  phases have a real recovery point.
- `.gitignore` was extended in Phase 0 (additive only): runtime SQLite artifacts
  (`/db/*.db`, `/db/*.db-journal`) and sandbox platform infra (`.zscripts/`) are
  ignored. Nothing tracked was removed.

## 3. Detected Frontend Stack

- **Framework:** Next.js `16.1.1` (App Router, `output: "standalone"`)
- **UI:** React `19`, Tailwind CSS `4`, shadcn/ui (New York style; ~50 components
  in `src/components/ui/`), Lucide icons, Framer Motion `12`
- **State:** Zustand `5`, TanStack Query `5` (installed, not yet wired to features)
- **Language:** TypeScript `5` (strict mode; see known issues §8)
- **Tooling:** Bun runtime/package manager, ESLint 9 (`eslint-config-next`)

## 4. Detected Backend / Data Stack

- **API:** Next.js Route Handlers (`src/app/api/route.ts` returns a hello-world JSON)
- **ORM:** Prisma `6.11` (SQLite provider) — schema at `prisma/schema.prisma`
- **DB client:** singleton at `src/lib/db.ts`
- **AI SDK:** `z-ai-web-dev-sdk` installed (**backend-only** usage rule)
- **Auth:** `next-auth@4` installed, not configured
- **Realtime:** socket.io reference demo in `examples/websocket/`

## 5. Database State

- SQLite file: `db/custom.db` (~24 KB) — **untouched in Phase 0** (read-only
  inspection only).
- Tables present: `User`, `Post` (scaffold defaults; no application data written).
- `DATABASE_URL=file:/home/z/my-project/db/custom.db` (see `.env`).
- **Never** drop the database, truncate tables, or delete migrations. Schema
  changes go through `prisma/schema.prisma` + `bun run db:push`, after a backup:
  `cp db/custom.db db/custom.db.bak-<phase>`.
- The `db:push` script contains `--accept-data-loss`; treat it as dangerous and
  review schema diffs before running it in later phases.

## 6. Environment Variables

| Name | Purpose | Secret? |
| --- | --- | --- |
| `DATABASE_URL` | SQLite file location | No |
| *(AI/search SDK keys)* | Provided by the sandbox platform to `z-ai-web-dev-sdk` at runtime; never commit keys | Yes |

`.env` is gitignored by pattern; the pre-existing tracked copy only ever contained
`DATABASE_URL`.

## 7. Important Directories

| Path | Role |
| --- | --- |
| `src/app/` | App Router: `/` page, `/api` route handler, root layout |
| `src/components/ui/` | shadcn/ui component set (do not rebuild from scratch) |
| `src/types/contracts.ts` | Phase 0 typed contracts (PhaseStatus, AgentStatus, ActivityKind, …) |
| `src/features/`, `src/services/`, `src/stores/` | Frontend domain skeletons |
| `src/server/**` | Backend domain skeletons (api, models, schemas, services, repositories, agents, search, graph, execution, security, testing, git, jobs) |
| `prisma/` | Schema source of truth |
| `examples/websocket/` | Realtime reference demo |
| `mini-services/` | Future independent services (own ports) |
| `Caddyfile` | Gateway: `/` → :3000, `?XTransformPort=` → aux services |
| `tests/` | Sandbox runtime verification scripts (pre-existing) |
| `ARCHITECTURE.md` | Target architecture + contracts |
| `CHANGELOG.md` | Phase-by-phase change log |
| `worklog.md` | Agent work journal (append-only per task) |

## 8. Known Issues / Limitations

1. `tsconfig.json` has `strict: true` but `noImplicitAny: false` — weaker than
   full strictness. Left as-is (baseline preservation); later phases may tighten.
2. `next.config.ts` sets `typescript.ignoreBuildErrors: true` and
   `reactStrictMode: false` — scaffold defaults, preserved. `bun run lint` is the
   current quality gate.
3. `package.json` `db:push` uses `--accept-data-loss` (see §5).
4. No application tests exist yet; `tests/` contains environment probes only.
5. No CI pipeline yet.
6. The `.gitignore` entries `test` and `prompt` match any path segment with those
   names — be careful naming future files/dirs exactly `test` or `prompt`.
7. Single-port gateway: auxiliary services must use `XTransformPort` routing with
   relative URLs only.

## 9. Recovery Instructions

```bash
# 1. Restore the exact Phase 0 state
git checkout main
git checkout codemind-v2/phase-00-foundation -- .   # or: git reset --soft <tag> on a fresh clone

# 2. Reinstall dependencies
bun install

# 3. Regenerate the Prisma client
bun run db:generate

# 4. Restore a database backup if needed
cp db/custom.db.bak-<phase> db/custom.db

# 5. Start the dev server
bun run dev        # port 3000, logs → dev.log
```

Rollback of the working tree to the pre-phase baseline commit: `git diff 247ec7d`
to inspect, and restore individual paths from that commit — never `reset --hard`.

## 10. Phase Tracking

- **Implemented phases:** Phase 0 — Foundation; Phase 0 governance addendum
  (V2.1) — `RULES.md` + `CAPABILITIES.md` + proof standards; **Phase 1 —
  premium design system, motion engine, shader engine** (dark-first token
  system, 9 motion primitives, AuroraText/DiaTextReveal reconstructions,
  6-mode WebGL ShaderBackground with CSS fallback, design-system showcase);
  **Phase 1 — public website reconstruction** (full product website on `/`:
  navbar/hero/particles/4-pane workspace preview, 14 product sections,
  ExpandableBentoGrid + GSAP StaggeredProductGrid, AI activity + product
  preview component libraries under `src/components/{ai,product,layout,particles}/`,
  site composition under `src/features/site/`, SEO metadata, honest
  demo-data labeling, reduced-motion + fallback coverage; dependency added:
  gsap 3.15.0, dynamically imported).
  **Phase 2 — workspace shell** (`/app`): four-panel AI IDE
  (11/11/39/39, resizable, persisted v1 schema), CodeMind X sidebar +
  AI chat sidebar with independent functional icon rails, command palette
  (⌘K/⌘P), keyboard contracts, EditorNavigationService, real read-only
  repository APIs (meta/tree/file with strict allowlisting), real single-shot
  assistant API (backend SDK), honest empty/planned states everywhere;
  landing CTAs now route to `/app`. Engines (indexing, hybrid search,
  agents, Git/security/testing intelligence, sandbox, Monaco) remain
  [PLANNED] and are represented only as honest extension points.
- **Next intended phase:** Phase 4 (per the canonical order). Every phase
  must read `RULES.md` first and consult `CAPABILITIES.md`.
- **Phase 2.5 — V2.1 fixed-shell directive (user, mid-Phase-3):** both the
  CodeMind X sidebar and the AI Chat Sidebar are FIXED at exactly 11%
  (`PANEL_LIMITS min === max`, permanently disabled boundary handles —
  react-resizable-panels requires handle elements between panels, disabled
  ones register no drag/keyboard handler). Only the chat|repo split remains
  user-adjustable. Workspace layout schema v3 resets persisted v2 layouts.
  "Reset workspace layout" now re-syncs mounted panels live (reset nonce +
  imperative resize). Mobile responsiveness intentionally not reworked in
  this pass (user directive).
- **Phase 3 — backend, API, database, jobs, streaming infrastructure:**
  decision taken under the spec's escape clause ("Use Python + FastAPI
  unless an existing backend architecture should safely be retained") — the
  Next.js + Prisma backend was retained; FastAPI/PostgreSQL/Redis remain
  [PLANNED] in `CAPABILITIES.md` with the local-runtime equivalents built
  for real. Delivered: 20 additive Prisma domain models (22 tables, FKs,
  indexes, timestamps, delete rules, public ids; legacy data untouched);
  layered `src/server/{api,schemas,services,security,events,jobs}`;
  consistent `{success, data, requestId}` / `{success:false, error:{code,message}}`
  envelope on 16 route files across the 14 spec API groups (real: health,
  repositories, branches, files, search, git, assistant; honest-501
  skeletons: auth, architecture, security, testing, documentation, impact,
  evaluation); security foundation (structured logs, request ids, body-size
  guard, honest auth seam, `.env.example`, security headers); job system
  with the 6 spec states + checkpoints + restart recovery; typed SSE event
  streaming (`/api/events`, `/api/assistant/stream`) with privacy-enforced
  schemas; real `repository.index` job (207 files indexed). Deviations:
  no pytest/backend test files (platform policy forbids test code in this
  environment) — compensated with live curl/browser probes; `bun run
  build` not run (platform constraint) — lint + tsc + runtime verification
  used instead.
