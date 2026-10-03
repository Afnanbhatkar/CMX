# Changelog

All notable changes to CodeMind X V2 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
is phase-based during the V2 build-out.

## [Phase 4 — GitHub + Large-Repository Ingestion] — import engine, auth/observability/audit foundations

### Added
- **Workspace UI directives (user, this session)**: sidebar panels are again
  user-adjustable — 11% default, **min 11% / max 15%** (never below 11, never
  above 15; keyboard + drag). Sidebar content now adapts INSIDE its block at
  narrow widths (e.g. 11% at a 1024px window): AI-context rows stack, the
  "Start New Chat" label swaps to "New chat", the CodeMind X wordmark swaps
  to the logo icon — nothing overflows or clips. The repository **explorer
  column can be closed** (close icon in its header) for full-width code
  focus; reopening is one click from the editor tab strip or the explorer/
  search rail icons. Explorer open/closed state persists (workspace layout
  schema v4 — persisted v3 layouts reset to the canonical 11|11|39|39).
- **Repository import engine** (`src/server/ingestion/` + `repository.import`
  job): public GitHub URLs, generic Git HTTPS URLs, local dev directories
  (cwd-scoped), and ZIP uploads; branch/tag/commit refs (shallow clone for
  branch/tag, full clone for commits — honest limitation); sparse checkout;
  incremental fetch reusing a matching isolated workspace; isolated
  per-import workspaces under `.ingestion-workspaces/<uuid>/` (git-ignored,
  outside the UI allowlist); default ignore set (node_modules/.git/dist/
  build/coverage/.cache/logs/temp) with explicit include/override; resumable
  checkpoints carrying ALL spec §5 fields (repository_id, job_id, stage,
  current_file, processed_count, total_count, checkpoint_token,
  last_successful_operation) in `analysis_checkpoints` + the on-disk
  `.codemind-import.json` marker; pause/resume/cancel via the existing job
  control API (git child SIGKILLed on cancel); static-only ingestion (the
  only binary ever executed is `git`, hardened argv + sanitized env, hooks
  disabled, prompts disabled).
- **Import security (spec §6)**: path traversal rejection (no `..`,
  absolute, NUL, drive letters, backslashes), symlink skip + count, ZIP
  hardening (fflate; 50k entries, 512 MB total, 25 MB/entry, >200× ratio
  rejection), per-file 10 MB skip+count limit, 1 GB per-workspace disk
  quota (env-tunable), credential redaction (`redactSecret`) on every log/
  error/DB field — tokens live only in the process-ephemeral vault for the
  duration of the import and are never persisted, logged, or echoed.
- **Typed `REPOSITORY_IMPORT` stream events** (strict zod, privacy
  contract): validating → authenticating → cloning/extracting → discovering
  → parsing → indexing → finalizing with real counts; SSE replay + live.
- **Import API + UI**: `POST /api/repositories/import` (202 + jobId, never
  blocks on a clone), `POST /api/repositories/import/zip` (multipart, 32 MB
  cap), `GET /api/repositories/import` (provenance + chain-link follow);
  Import dialog on the Repository page with the spec §7 stage checklist,
  real counts (no fake progress), Pause/Cancel, and the real imported-
  repositories list.
- **V2.1 §A Auth foundation** (`src/server/security/auth.ts`): AuthProvider
  abstraction + registry, hash-only session lifecycle (create/validate/
  revoke; SHA-256 token hashes, raw tokens never stored), `requireAuth`/
  `requireRole`/`canAccessRepository` (repository-level roles reader<
  writer<maintainer<owner via `repository_members`), opt-in `requireAuth`
  in `withApi`; default remains honestly "unconfigured" — no route claims
  auth. NextAuth [PLANNED].
- **V2.1 §B OpenTelemetry**: `@opentelemetry/api` + `sdk-trace-base` wired
  via `src/instrumentation.ts` + `src/server/observability/tracing.ts`;
  `http.request` spans on every API route, `assistant.completion` spans,
  W3C traceparent propagation (verified end-to-end), common attributes
  (request_id, repository_id, run_id, agent_id, tool_id, model, provider,
  job_id); secrets never attached; OTLP export [PLANNED].
- **V2.1 §D usage primitives** (`usage_records` + `usage-service`): real
  provider/model/token counts/latency recorded per assistant turn (shape
  discovered from the actual SDK response; nulls stay null — never
  fabricated), ready for Phase 3.5 accounting.
- **V2.1 §E audit foundation** (`audit_logs` + `audit` service): closed
  action vocabulary (login, repository.access, repository.import, git
  mutation, memory change, autonomy change, MCP invocation…); wired today
  to real events only (file/tree access with path-only metadata, session
  lifecycle); the rest wire when their features arrive.
- **V2.1 §C memory schema reservation**: `memory_items`, `memory_events`,
  `user_profiles`, `glossary`, `decision_records` (+ indexes for scope,
  type, status, last_used, repository) — tables live, writers arrive in
  later phases.

### Fixed
- **`runGit` settlement bug** (found by live import probe): the child
  `close` handler set `settled` before calling its own `fail()` helper,
  which early-returned — `reject()` was never invoked for any non-zero git
  exit, hanging the import job forever (recovery then re-queued it in a
  loop). Every settle path now resolves/rejects exactly once.
- **`GIT_ALLOW_PROTOCOL` vs file transport**: with a multi-protocol list in
  the env, git denies `file://` even with `-c protocol.file.allow=user`;
  the env var is gone (argv per-protocol override remains).
- **Import marker timing**: the `.codemind-import.json` marker was written
  before cloning, making the destination non-empty — git clone refused
  every fresh import. Marker now written after checkout.
- **Recovery safety**: interrupted-job recovery now requires an 11-minute
  stale heartbeat and requeues via a conditional atomic update (Next dev
  worker processes no longer re-queue each other's live jobs), and the
  always-pump drain was restored so QUEUED rows from a previous process
  actually start after a restart.
- **`withApi` ApiError identity**: dev-mode Turbopack can compile multiple
  envelope-module copies, so `instanceof` missed real ApiErrors and honest
  409/404s became 500s (observed on job control). `withApi` now recognises
  ApiError-shaped errors (code + 4xx/5xx status) as well.
- Stale in-process PrismaClient after a schema push (dev server restarted
  once during verification; flagged in the worklog, self-heals on restart).

## [Phase 3 — Backend, API, Database, Jobs, Streaming] — infrastructure foundation

### Added
- **Database (Prisma/SQLite, purely additive)**: 20 domain models per the
  Phase 3 spec — repositories, repository_branches, repository_files,
  repository_symbols, repository_chunks, analysis_jobs, analysis_checkpoints,
  chat_sessions, chat_messages, agent_runs, activities, approvals,
  security_findings, generated_tests, documents, git_commits, git_branches,
  evaluations, code_changes, change_sets — with FKs + explicit delete rules
  (Cascade/SetNull), indexes, timestamps, composite uniques, public ids.
  Legacy `User`/`Post` and data preserved byte-for-byte (`prisma db push`
  without data-loss flags; never destructive).
- **API layer** (`src/server/api`): consistent envelope
  `{success:true,data,requestId}` / `{success:false,error:{code,message},requestId}`,
  `ApiError` + zod validation mapping, request-id header, structured
  per-request log lines, 1 MB body guard, security headers; Next 16 async
  params stay type-safe.
- **Versioned API groups**: real — `/api/health` (+ `/health` alias),
  `/api/repositories` (+`/[id]`), `/api/branches`, `/api/files`,
  `/api/search`, `/api/git` (real branch + last 20 commits), `/api/assistant`;
  honest-501 skeletons — `/api/auth`, `/api/architecture`, `/api/security`,
  `/api/testing`, `/api/documentation`, `/api/impact`, `/api/evaluation`.
  Legacy `/api/repository/*` and `/api/ai/chat` contracts unchanged.
- **Security foundation** (`src/server/security`): JSON structured logger,
  auth-ready seam (honest "unconfigured" — never claims auth), security
  config (same-origin CORS strategy, upload limits, rate-limit [PLANNED]),
  `.env.example` (names only).
- **Job system** (`src/server/jobs`): spec's 6 states
  QUEUED/RUNNING/PAUSED/CANCELLED/COMPLETED/FAILED, DB as source of truth,
  pause/resume/cancel controls with 409 on invalid transitions,
  throttled progress + checkpoints (`analysis_checkpoints`), restart
  survival (orphaned RUNNING jobs are requeued with attempts+1 on boot;
  verified live), registry-validated job types.
- **Real `repository.index` job**: walks the workspace tree with the
  established ignore rules, upserts Repository/RepositoryBranch/
  RepositoryFile rows (207 files indexed in verification), emits typed
  progress events, resumes from checkpoint.
- **Typed event streaming** (`src/server/events` + routes): discriminated
  `CodeMindEvent` union (ACTIVITY_*, JOB_*, REPOSITORY_INDEXING,
  ASSISTANT_*, STREAM_HEARTBEAT) with `.strict()` zod schemas enforcing the
  activity-privacy contract (operational labels only — no model reasoning);
  SSE endpoints `/api/events` (+`/stream`) with replay buffer + heartbeats,
  and `/api/assistant/stream` streaming real completions (token-level
  granularity honestly deferred until the gateway exposes streaming — no
  fake chunking).

### Changed
- Chat completion logic extracted into `src/server/services/assistant-service.ts`;
  `/api/ai/chat` is now a thin handler with a byte-identical public contract
  (verified against the frontend payload shape). Assistant turns now persist
  honest `activities` rows.

## [Phase 3 — V2.1 Fixed-Shell Directive] — fixed sidebars + shell contracts

### Changed
- **Sidebars fixed at 11%** (user directive): `PANEL_LIMITS` for `cmx` and
  `chatSidebar` locked to `min === max = 11`; the boundary handles are
  permanently disabled (react-resizable-panels requires handle elements
  between adjacent panels — disabled handles register no drag/keyboard
  handler, so the rail is honestly fixed with zero resize affordance). Only
  the chat|repo split remains adjustable (keyboard + drag verified).
- **Workspace layout schema v3** (`WORKSPACE_LAYOUT_VERSION = 3`): persisted
  v2 layouts reset to the canonical 11 | 11 | 39 | 39; conversations, tabs
  and section preserved. `repoRailView` now persists (V2.1 §D).
- **"Reset workspace layout" now re-syncs mounted panels** via a transient
  `layoutResetNonce` + imperative panel resizes (previously it only reset
  the store and the visible layout kept the old split until reload).

### Verified (V2.1 additions A–H)
- A shared `EditorNavigationService` (single file-opening path), B
  keyboard-first contracts (⌘K/⌘P/⌘B/⌘⌥B/⌘I/⌘1–4, visible shortcuts,
  honest disabled palette entries), C AI Context rail surface, D/E
  persistence incl. independent rail states, F canonical 11+11+39+39
  (measured 10.99/10.99/38.96/38.96 at 1920 fullscreen), G modular
  replacement seams, H functional collapsed icon rails (48px exact, tooltips,
  badges, focus states) — all browser-verified.

## [Phase 2 — Shell UX Fixes] — Assistant-scoped chrome & exact rail collapse

### Fixed
- **AI sidebar collapse at fullscreen** (`AIWorkspace.tsx`): collapsed panels
  are now LOCKED to the exact 48px rail width (`minSize = maxSize = railPct`,
  viewport-tracked via rAF) instead of being clamped up to the 4% panel
  minimum — previously the rail kept ~29px of dead space around its icons on
  large/fullscreen windows while closing tightly only in the narrow preview.
- **AI sidebar content wrapping** (`AIChatSidebar.tsx`): replaced the Radix
  ScrollArea viewport (`display: table` sizing that clipped cards/buttons at
  narrow widths) with a plain block scroll container; container-query adaptive
  quick actions (2 columns only ≥240px), wrapping active-file context row,
  truncation-hardened labels. Sidebar content now wraps cleanly at the 11%
  default width (e.g. 140px at 1280).
- **Layout drift**: `onLayout` no longer writes collapsed rail widths or
  two-panel destination layouts into the persisted four-panel sizes.

### Changed
- **Assistant-scoped chrome**: the AI chat sidebar and the VSCode-style
  repository panel render ONLY on the Assistant destination (desktop four-panel
  layout + compact sheet shortcuts). Every other destination is a focused
  two-panel view; the Repository destination now has a dedicated page
  (`RepositoryOverviewPanel`): real repo meta, filterable real file tree,
  read-only file preview with honest error states — no IDE chrome.
- **Persisted layout schema v1 → v2** (`types.ts`, `workspace-store.ts`):
  older persisted layouts reset to the intended 11% | 11% | 39% | 39%
  defaults (conversations/tabs preserved); 11% remains the open default and
  user resizing (4%–22%) still persists.
- Compact nav Sheet now closes on destination change.

## [Phase 2 — Workspace Shell] — Advanced Application Shell & Four-Panel AI IDE

### Added
- **`/app` workspace route** (`src/app/app/`): the main CodeMind X software
  engineering workspace — four-panel desktop shell (CodeMind X sidebar 11% ·
  AI chat sidebar 11% · AI chat area 39% · repository/code 39%, resizable,
  persisted), compact tablet/mobile layout (persistent CMX icon rail on
  tablet ≥768px, chat always primary, Sheet drawers for nav / chat sidebar /
  repository). Landing page "Open Workspace" CTAs now route to `/app` (client
  navigation; the Phase 1 page itself was not redesigned).
- **Workspace foundation** (`src/features/workspace/`, `src/stores/`):
  typed contracts (`types.ts` — panel sizes/limits, destinations, conversations,
  AIRunPhase vocabulary, editor-navigation payload, command definitions),
  destination registry (`registry.ts`, availability reflects real
  capabilities), central zustand store with **versioned persisted layout
  schema v1** (sizes/collapsed/expanded widths/section/conversations/tabs;
  validation + clamping on rehydrate; secrets and file contents never
  persisted; conversation caps 30 × 200 messages).
- **EditorNavigationService** (`editor-navigation.ts`): THE single file-opening
  mechanism (spec §28) — typed payload (repository/filePath/line/column/range/
  symbol/sourceContext/reason), verifies against the real file API, honest
  typed failure results (not-found / binary / too-large / load-failed) with
  toast, subscriber-based (repository workspace opens tabs).
- **Shell components** (`components/`): `AIWorkspace` (responsive switching,
  four-panel composition with imperative rail collapse, ⌘K/⌘P/⌘B/⌘⌥B/⌘I/⌘1–4
  keyboard contracts, hydration gate), `TopNavigation` (real repository name +
  real git branch, honest "Indexing unavailable", run indicator, notifications
  popover, compact sheet openers), `AISidebar` (13 destinations, expanded +
  functional icon rail with tooltips/aria/active states, real footer info),
  `PanelResizer` (visible feedback, disabled when adjacent rail collapsed),
  `CommandPalette` (⌘K commands / ⌘P real file picker over the workspace tree;
  later-phase commands listed **disabled with honest reasons**),
  `OverviewPanel` (real capability status list), `SettingsPanel` (layout reset,
  shortcuts, honest data-storage notes), `SearchFilesPanel` (real filename
  filter → opens real files), `DestinationPlaceholderPanel` (honest wired
  extension points), `ChatAreaRouter`.
- **AI chat side** (`chat/`): `AIChatSidebar` (New Chat, labelled conversation
  search, Current/Pinned/Recent/Archived sections with real timestamps and
  statuses, rename/pin/archive/delete — all real local actions, honest
  AI-workspace-context section fed by the real meta API + open tabs, Current
  AI Run indicator over the shared phase vocabulary, quick actions, reserved
  Search/Code/Agent/Loop mode chips, **independent functional collapsed icon
  rail** per spec §15), `AIChatPanel` + `ConversationView` (per-state message
  rendering, privacy-safe ThoughtChain activity, copy/regenerate/retry, always
  visible composer), `AIComposer` (auto-resize, Enter/Shift+Enter, attachments
  incl. real active-file attachment, stop/regenerate, disabled mode chips),
  `ChatMarkdown` + `ChatCodeBlock` (copy/expand/download, `// file:` reference
  opens via EditorNavigationService), `ApprovalCardSlot` (typed contract only —
  renders nothing until real approvals exist), `useAssistantRun` (real
  single-shot assistant calls via backend, stop via AbortController, honest
  error/stopped states — no simulated streaming).
- **Repository / code side** (`repository/`): `RepositoryWorkspaceShell`
  (activity rail: Explorer/Search/Source Control/Run/Extensions +
  diagnostics toggle; subscribes to EditorNavigationService),
  `RepositoryExplorerShell` + recursive file tree (real tree, filter,
  loading/error/retry states), `EditorTabs`, `CodeEditorViewport` (read-only
  real file preview, honest binary/too-large/missing/error states, line
  highlighting from navigation payloads, "Monaco arrives later" note),
  `TerminalOutputPanel` (honest no-execution state + real environment facts),
  `DiagnosticsPanel`, `GitPanel` (real branch, explicitly no fake commits),
  honest placeholder views for run/extensions.
- **Real read-only repository APIs** (`src/app/api/repository/` +
  `src/lib/server/repository-fs.ts`): `GET meta` (package.json name + real
  `git rev-parse` branch + honest indexing status), `GET tree` (allowlisted
  roots: `src/**`, prisma schema, key configs; traversal/dotfile/secret
  exclusion; depth/entry caps; 30 s cache), `GET file` (strict allowlist,
  binary detection, 512 KB cap; 400/403/404/413/415 semantics). This makes the
  workspace shell REAL (tree/tabs/editor) while indexing/search/git engines
  remain [PLANNED].
- **Real assistant API** (`src/app/api/ai/chat/route.ts`): zod-validated
  single-shot LLM completion via the backend SDK with an honesty-constrained
  system prompt (states unimplemented engines instead of pretending); powers
  the chat shell end-to-end (user message → activity summary → assistant
  response → retry/stop/regenerate).

### Verified
- Lint clean across `src/features/workspace/**`, `src/stores/**`,
  `src/lib/server/**`, new API routes, landing edits; no new TypeScript
  errors (pre-existing `examples/`/`skills/` errors untouched).
- Browser-verified (agent-browser + Playwright): four-panel desktop at
  1280/1440/1920 with 11/11/39/39 defaults, drag-resize + persistence across
  reload, both independent icon rails (collapse/expand/restore widths),
  ⌘K/⌘P palettes (real file open via palette), real file open from tree +
  AI-context chip, real AI conversation (send → activity → response →
  Completed status → run indicator back to Idle), planned-destination honest
  placeholders, mobile drawers at 390/768, **zero horizontal overflow at
  360/390/768/1024/1280/1440/1920**, zero console errors, reduced-motion
  probe (9/9 PASS), persisted state contains no secrets.
- APIs verified by direct request: meta (real branch `main`), tree, file
  (real content), traversal `../.env` → 403, `.env` → 403, missing → 404,
  assistant round-trip.

### Honest limitations (by design, Phase 2 scope)
- Assistant is single-shot (no streaming, no tools/agents/repository
  retrieval) — the execution engine is a later phase; the run-state
  vocabulary and activity surfaces are typed contracts.
- Editor is a read-only preview (Monaco [PLANNED]); repository search filters
  filenames only (hybrid search [PLANNED]); Git shows the real branch only
  (Git intelligence [PLANNED]); terminal shows environment facts only (sandbox
  execution [PLANNED]); conversations persist in localStorage (database
  persistence [PLANNED]).
- Checkpoint: `codemind-v2/phase-02-workspace` (local commit + annotated tag).

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
