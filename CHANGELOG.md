# Changelog

All notable changes to CodeMind X V2 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
is phase-based during the V2 build-out.

## [Phase 1 — Public Website] — Premium Product Website & Frontend Foundation

### Added
- **Public website reconstruction** (`src/features/site/`): the homepage is now a
  complete CodeMind X product website (narrative order per Phase 1 spec §24):
  navbar (fixed, anchor-based, mobile Sheet menu) → hero (shader bed +
  interactive particle field + AuroraText headline + honest CTAs + capability
  signals + 4-pane workspace preview) → what-is story → features bento →
  repository intelligence → hybrid search → code understanding → AI assistant →
  architecture → AI coding → security + testing → Git intelligence →
  connected-context composite → product surface grid → how-it-works → final CTA
  → footer.
- **AI activity reference components** (`src/components/ai/`): `ThinkingOrb`
  (dark container, layered warm orb, idle/thinking/done states),
  `LatticeLoader` (3×3 rAF wave, pauses offscreen/hidden), `ThoughtChain`
  (category-based, privacy-safe labels only — no chain-of-thought),
  `ActivityPreview` (one-shot in-view sequencer + replay, categories per
  `ActivityKind` contract).
- **Product preview components** (`src/components/product/`): `CodePreview`
  (hand-rolled tokenizer, line numbers, copy interaction, highlight lines),
  `RepositoryPreview` (tree + status badges + animated dependency curves +
  AI-context chip), `GraphPreview` (8-node SVG service graph, draw-in edges),
  `SecurityPreview` (finding w/ severity, request path, evidence),
  `TestingPreview` (suite rows, failure detail, coverage bar — synthetic),
  `GitPreview` (commit chain, changed files, impact), `SearchPreview`
  (query → keyword/semantic/symbol/related results), `AICodingPreview`
  (Request→Plan→Diff→Verify→Apply; Apply visibly disabled — approval contract),
  `ProductPreview` (11/11/39/39 workspace mock with entrance choreography),
  `shared.tsx` (DemoBadge honesty marker, PreviewFrame, StatusDot, code
  palette). All demo data is labeled — no fake metrics, customers, or
  benchmarks anywhere on the page.
- **Motion additions** (`src/components/motion/`): `ScrollReveal`,
  `StaggerReveal`/`StaggerItem`, `Parallax` (scroll-linked, coarse-pointer and
  reduced-motion safe) + barrel exports.
- **`components/particles/InteractiveParticles.tsx`** — canvas-2D repository
  network field (bounded counts, damped pointer attraction, DPR ≤ 2, pauses
  hidden/offscreen, static frame under reduced motion, CSS fallback on
  init failure).
- **`components/layout/`**: `ExpandableBentoGrid` (layoutId shared-element
  expansion, outside click, Escape, body scroll lock, focus restore, dialog
  semantics), `StaggeredProductGrid` (GSAP ScrollTrigger offset columns,
  scrub parallax, dynamic-imported gsap, context revert; content never
  pre-hidden so JS failure cannot blank it).
- Site composition pieces: `LogoMark` (SVG monogram), `SectionShell`,
  skip-to-content link, sticky-footer contract (`min-h-screen flex flex-col`
  + footer `mt-auto`).
- SEO: full metadata (title, description, keywords, Open Graph, Twitter card)
  in `src/app/layout.tsx`; semantic headings per section.

### Changed
- `src/app/page.tsx` — replaced the Phase 1 design-system showcase with the
  public website (justified redesign; showcase preserved in git history at
  `codemind-v2/phase-01-ui`^ and in `src/features/design-system/` files, kept
  for a future gallery route).
- Dependency added: **gsap 3.15.0** (ScrollTrigger for the staggered grid only;
  dynamically imported so it stays out of the initial bundle).

### Fixed (during browser verification)
- Product barrel race between parallel sub-agents (2-c/2-d) — merged exports.
- Pre-existing type errors in the site dependency path: missing `ReactNode`
  import in `ShaderBackground.tsx`, `children` type mismatch in
  `TextRevealHeading` (+ unused import).
- Malformed Tailwind arbitrary value `md:grid-cols-inmax(0,1fr)_188px]` in
  `RepositoryPreview.tsx` → `md:grid-cols-[minmax(0,1fr)_188px]`.
- **Horizontal overflow on mobile (457px @ 390px viewport)**: grids with only
  `lg:grid-cols-*` had content-sized implicit base columns — added explicit
  `grid-cols-1` across site sections, footer, RepositoryPreview.
  Overflow now **0px at 360/390/768/1024/1280/1440/1920**.
- Radix `DialogContent` missing-description warning in the mobile nav Sheet —
  added `sr-only` `SheetDescription`.

### Verification
- `bun run lint` clean; `tsc --noEmit` clean for all of `src/`.
- Browser (agent-browser, desktop 1440 + mobile 390): zero console errors;
  hero, all 14 sections, bento expand/Escape/scroll-restore, focus management,
  anchor navigation (desktop + mobile Sheet), particle field, shader beds,
  ProductPreview choreography, copy interaction all exercised via golden-path
  clicks. Sticky footer verified; footer flush at document end.
- Reduced motion verified at runtime via CDP
  (`Emulation.setEmulatedMedia prefers-reduced-motion: reduce`): headline and
  all product visuals fully visible immediately (h1 opacity 1), all 14 anchors
  present, no hidden content, no overflow.
- Honest-routing rule: "Open Workspace" scrolls to the labeled workspace
  preview (`#workspace`); the live workspace is explicitly stated to ship in
  Phase 2 — no fake navigation, no fake data.
- Checkpoint: tag `codemind-v2/phase-01-ui` re-pointed (forward, local only,
  annotated) from the design-system sub-deliverable commit to this completed
  Phase 1 commit; prior commits untouched, nothing pushed.

## [Phase 1] — Premium Design System, Motion Engine & Shader Engine

### Added
- **Design tokens** (dark-first cinematic identity: deep warm near-black,
  graphite surfaces, rust/copper accent; no blue/indigo chrome):
  - `src/app/globals.css` — surface / surface-hover / surface-elevated /
    border-subtle / success / warning / danger / info / selection / focus
    tokens + motion duration/easing vars, wired into Tailwind 4 `@theme inline`;
    shadcn palette restyled to the CodeMind identity (all primitives kept).
  - `src/lib/design-tokens.ts` — TS mirror: motion durations/easings, springs,
    z-index scale, breakpoints, reference gradients (AURORA_GRADIENT,
    SWEEP_GRADIENT).
- **Motion engine** (`src/components/motion/`, all `use client`, reduced-motion
  aware, deterministic cleanup): FadeIn, SlideIn, ScaleIn, Shimmer, TypingText,
  TextReveal, GradientText, PanelTransition, ActivityTransition, plus barrel.
- **Reference reconstructions** (self-contained, independently replaceable,
  no global CSS pollution):
  - `motion/AuroraText.tsx` — exact supplied gradient stops, background-size
    300% 100%, position sweep 0%→100%→0%, hue-rotate 0→12→−8°, subtle glow,
    `speed`/`colors` props.
  - `motion/DiaTextReveal.tsx` — gradient sweep + clipped word reveal,
    `string | string[]` phrases, `repeat`, fluid `clamp()` typography,
    static reduced-motion fallback.
  - `background/ShaderBackground.tsx` — raw WebGL1 fragment-shader engine with
    6 modes (Rust Mesh, Noir Mesh, Neural Flow, Graph Field, Deep Space,
    Minimal); props speed/intensity/opacity/grain/mouseInteraction/mobileMode/
    reducedMotion/fallback; DPR ≤ 1.5 (≤1.0 mobile), pauses when tab hidden or
    offscreen (visibilitychange + IntersectionObserver), static single frame
    under reduced motion, damped pointer parallax, context-loss handling and
    CSS-gradient + SVG-grain fallback when WebGL is unavailable.
- **Showcase** (`src/features/design-system/`): hero (shader + AuroraText +
  DiaTextReveal), motion lab (9 primitive demos incl. visual states
  loading/active/completed/disabled + reduced-motion simulation), shader lab
  (live controls for all shader props). Consumes Phase 0 `ActivityEvent`
  contracts. Replaces scaffold placeholder `src/app/page.tsx`.
- `layout.tsx` metadata updated to CodeMind X.

### Fixed (during browser verification)
- Shader canvas collapsed to 1px height when consumers passed `absolute` —
  component root now owns positioning via inline style; hero wraps in a
  positioned box.
- Missing `useState` import in shader-lab (caught by runtime 500, fixed).
- Shader mode ToggleGroup overlap (`flex-1` segmented design vs. wrap) —
  replaced consumer-side with wrapped `Button` group (`aria-pressed`);
  protected shadcn files untouched.
- Dev server served stale compiled CSS after globals.css rewrite — resolved by
  restarting through the platform lifecycle script; dark tokens verified live
  via computed styles.

### Verification
- Browser (agent-browser): renders with zero console errors; both WebGL
  canvases at full dimensions; all 6 shader modes switch live; activity stream
  appends real items; reduced-motion simulation works; synthetic
  `webglcontextlost` → CSS fallback engages and page survives; horizontal
  overflow **0px** at 360/390/768/1024/1280/1440/1920; footer flush with
  document end (0px gap, `mt-auto` sticky contract). Screenshots saved:
  desktop hero (dark), noir/graph-field modes, mobile 390px, full page.
- Lint: clean. Baseline-preservation test: motion/background components import
  only `react` + `framer-motion` + design-tokens — no server/DB/SDK coupling.
- Checkpoint: `codemind-v2/phase-01-ui`.

## [Phase 0 — Governance Addendum] (V2.1)

### Added
- `RULES.md` — binding governance baseline for all future phases: non-destructive
  git rules, protected paths, repository trust boundaries, prompt-injection rules,
  memory rules, approval policy, agent autonomy levels, evidence/proof-of-completion
  standard, no-fake-functionality policy, fallback/capability policy, performance
  budgets, definition-of-done rules, testing expectations, observability expectations.
- `CAPABILITIES.md` — honest runtime capability registry (PostgreSQL, SQLite, Redis,
  Qdrant, local vector fallback, Neo4j, NetworkX-style graph fallback, Docker,
  sandbox, Playwright, LSP, WebGL, local LLM, external LLM) with statuses
  `production | local | fallback | unavailable` + binding degradation ladder.
  Verified by binary/service detection (docker, redis, psql, qdrant, neo4j, ollama
  all absent; playwright/python3/bun present).
- Negative-example policy recorded in RULES.md §5/§9: the system must not store or
  learn secrets, credentials, private keys, raw tokens, repository text as
  instructions, README instructions as memory, or tool-output instructions as
  authority.
- Baseline-preservation test defined (replacing a single reference component must
  never require rewriting AI assistant, repository engine, or backend); initial
  architectural check passed — contracts are decoupled type-only vocabulary and
  reference components are leaf modules with typed props (re-verified in Phase 1).
- Phase reports now require a Definition-of-Done table
  (PASS | PARTIAL | BLOCKED | NOT IMPLEMENTED — BLOCKED never converted to PASS).

## [Phase 0] — Foundation (Safe Rebuild, Audit, Architecture)

### Added
- `ARCHITECTURE.md` — target layered architecture, AI request flow, code-change
  flow, domain boundaries, reference implementation contract, activity/thinking
  privacy contract. Explicitly separates implemented vs. [PLANNED] capabilities.
- `PROJECT_SAFETY.md` — project state, git state, detected stacks, database
  state, environment variables, directory map, known issues, recovery
  instructions, phase tracking.
- `CHANGELOG.md` (this file).
- `src/types/contracts.ts` — infrastructure type contracts: `PhaseStatus`,
  `AgentStatus`, `ActivityKind`, `ActivityEvent`, `PhaseInfo` (types only; no
  fake runtime behavior).
- Frontend domain skeletons: `src/features/`, `src/services/`, `src/stores/`.
- Backend domain skeletons: `src/server/{api,models,schemas,services,repositories,agents,search,graph,execution,security,testing,git,jobs}/`.
- `worklog.md` — append-only agent work journal.

### Changed
- `.gitignore` — additive entries only: `/db/*.db`, `/db/*.db-journal` (runtime
  SQLite artifacts) and `.zscripts/` (sandbox platform infra). No tracked entry
  removed.

### Preserved
- Entire pre-existing working tree (Next.js 16 scaffold: `src/`, configs,
  `prisma/`, `examples/`, `tests/`, `public/`, `Caddyfile`, `mini-services/`).
- Database `db/custom.db` untouched (read-only inspection).
- Scaffold `src/app/page.tsx` and `/api` route behavior unchanged.

### Safety
- No destructive Git operations (`reset --hard`, `clean -fd`, force push) used.
- Checkpoint created: tag `codemind-v2/phase-00-foundation`. Not pushed.

## [Baseline] — 247ec7d "Initial commit"
- Z.ai Code scaffold: `.env`, `.gitignore`, `download/README.md` tracked; full
  Next.js 16 + Tailwind 4 + shadcn/ui + Prisma (SQLite) working tree present but
  untracked until the Phase 0 checkpoint.
