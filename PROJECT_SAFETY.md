# CodeMind X V2 — Project Safety Document

> Living document. Every phase must re-verify and update this file.
> Last updated: Phase 0 (Foundation).

---

## 1. Current Project State

- Fresh Next.js 16 scaffold (Z.ai Code baseline, package `nextjs_tailwind_shadcn_ts` v0.2.1)
  being transformed into **CodeMind X V2**.
- **Phase 0 (Safe Rebuild / Audit / Foundation) implemented. No other phase started.**
- The application is runnable: dev server on port 3000, `/` renders, API route
  `/api` responds.
- No destructive operations were performed in Phase 0. No source was deleted,
  overwritten, or replaced with a template.

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
  6-mode WebGL ShaderBackground with CSS fallback, design-system showcase on
  `/`).
- **Next intended phase:** Phase 2 (per the canonical order). Every phase must
  read `RULES.md` first and consult `CAPABILITIES.md`.
