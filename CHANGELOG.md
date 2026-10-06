# Changelog

All notable changes to CodeMind X V2 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
is phase-based during the V2 build-out.

## [Phase 9.6 — Orchestrator Live in the AI Assistant Thought Chain] — 2026-10-06

### Added
- **Agent mode now runs the REAL Phase 9 multi-agent orchestrator inside the
  chat**, and every agent's actual work plays through the PROTECTED thought
  chain with zero changes to any frozen surface (chain-pacer, answer-pacer,
  ActivityChain close machine, send-scroll gate, chain-close gate, anchoring
  — all byte-identical). The planner, retrieval, code-analyst, graph,
  dependency, security, git, reasoning, coding and critic agents appear as
  the chain's own one-by-one rows with their real, fixed-format findings as
  row details ("intent: architecture … · plan: 4 steps → retrieval, graph,
  security, critic", "60 hits … (10.75ms, index: 360 files)", "static scan:
  8 files, 1 candidate findings", "answer drafted (2994 chars) with 4
  verifiable claims", "verdict: weak-evidence · 7 issue(s)…").
- New `src/server/services/orchestrator-turn.ts`: maps live engine events
  onto the existing 8B/8C stage-event vocabulary — one row per REAL
  execution fact (agent started/finished), SEARCH_RESULT + the file cascade
  from the retrieval agent's real scope, failed agents as failed rows,
  planned agents never faked (no row).
- Engine live-events (additive observer hook): `executeRun` accepts an
  optional event sink (agent-started / agent-finished / plan /
  approval-required / approval-decided / critic-verdict), returns its
  composed output, and a new `startChatOrchestration` entry awaits the run
  with cancellation (shared ACTIVE_RUNS registration — the console cancel
  route still works). The fire-and-forget console path is byte-identical.
- **Real approval gate in chat**: when the coding agent proposes a
  change-set, the run genuinely PAUSES at the engine's approval gate; the
  chat shows the real approval card MID-RUN (fixed: the card was hidden
  while the message was generating), the chain shows "Waiting for approval"
  with the run timer paused, and the decision is delivered via the new
  `POST /api/assistant/approvals` to the orchestrator's gate — the run then
  continues live in the same stream (critic → composed answer). Verified
  end-to-end: approve → 200 → waiting-approval → completed.
- Memory integration preserved: retrieved memories (Phase 9.5) ride into the
  orchestrator request as labeled context data (never instructions,
  precedence below repository evidence); the Memory Used chip, Context
  Inspector and incognito/depth controls keep working.
- Casual prompts in Agent mode keep the plain single-turn path (a greeting
  must not burn a six-agent pipeline); the composer's Agent-mode description
  and the mode prompt were updated to state the orchestrator honestly.
- Client disconnect / stop now cancels the underlying orchestration
  honestly (verified: hot-reload abort → run recorded `cancelled`).

### Honesty
- The result frame's note is now path-honest: orchestrator answers state
  "composed by the real multi-agent orchestrator" instead of the gateway
  streaming note; servedModel reports `multi-agent-orchestrator`.
- Failed agents (e.g. an unparseable model proposal) degrade exactly as the
  console does: failed row in the chain, "The run finished without a
  synthesized answer. Agents executed: …" in the answer — never faked.

### Verified (agent-browser + real gateway)
- Full agent story in the chain (planner → retrieval + search chips + real
  file reads → analyst/graph/security → reasoning → critic → honest
  re-retrieval loop), protected choreography intact via the gate probe:
  arm → loader-start (+311ms) → full-close (+1500ms — the mandated 1.5s) →
  release + answer-begin on the same tick; approval loop approved through
  the UI; zero page errors; lint 0 errors (1 pre-existing baseline warning).

## [Phase 9.2 — Thought Chain Working Phase: answer starts after the full close] — 2026-10-06

### Added
- **AI response starts ONLY after the chain fully closes** (user mandate,
  stored RULES.md §15 "Thought Chain Working Phase"; the user named the full
  send→scroll→chain→close→answer choreography and ordered it never changed
  until they say so): previously the word-by-word answer reveal began at the
  chain-close moment — i.e. DURING the mandated 1.5s last-row loader. Now
  the first streamed chunk is buffered honestly (real received text, never
  invented) until `ActivityChain`'s close machine fires the FULL one-shot
  close (`setFullClose(true)`), which releases the new
  `chat/activity/chain-close-gate.ts`; `use-assistant-run` then begins the
  reveal with the frozen answer-pacer rhythm. Safety-bounded at 2.5s so an
  unmounted/hidden view can never stall an answer; errors, stops and empty
  responses stay blunt and immediate (never gated).
- Full mandated run sequence now: send → smooth scroll to the pinned
  question → chain starts only on arrival → one-by-one reveal (frozen
  pacing) → last row completes → 1.5s loader → FULL one-shot close → THEN
  the AI response starts.

### Fixed
- **Answer pacer prematurely disposed while the reveal was gate-held** (found
  by the E2E gate probe): the run hook's `finally` block ran when the
  transport ended — BEFORE the chain's 1.5s loader + full close — and saw
  `isDraining() === false` (the drain is only invoked once the gate
  releases), so it disposed the answer pacer. At the close moment the
  buffered text's `push`/`syncFull` became no-ops and the terminal drain
  degenerated into an instant full-content write, destroying the frozen
  word-by-word reveal. The finally now disposes only when no gated reveal
  is still owed (`(!revealWaitStarted || terminalFlushed)`).
- `ActivityChain` close machine now uses the React-sanctioned render-phase
  adjustment pattern (previous `active` value in state) instead of
  synchronous setState inside an effect, which a lint toolchain update
  started rejecting at HEAD. Behavior is identical: same transitions, same
  1.5s loader timer, same full one-shot close, history views still skip the
  loader.

### Verification (probe)
- New read-only `window.__cmxChainGate` probe (same pattern as
  `__cmxAssistant`) logs arm → loader-start → full-close → release →
  answer-begin from the source of truth. Measured on a real gateway run:
  loader-start → full-close = **1501ms** (the mandated 1.5s); release and
  answer-begin land on the same ms as the full close; the assistant message
  shows ZERO answer text during the story and the entire loader window;
  the first visible answer characters appear only after the close and grow
  word-by-word (frozen rhythm).

### Unchanged (protected)
- `chain-pacer.ts` and `answer-pacer.ts` byte-identical to the frozen
  baseline — pacing, reveal rhythm and anchoring untouched.

## [Phase 9.5 — Adaptive Memory Engine + V2.1 Agent Safety] — 2026-10-06

### Added
- **Adaptive Memory Engine** (`src/server/memory/`): five memory layers
  (project-rule / decision / concept / preference / correction) over the
  additively-extended `MemoryItem` table — new fields `source`
  (explicit|inferred), `confidence`, `evidenceRefsJson`, `expiresAt`,
  `origin` (provenance guard), and extended scope/status/type vocabularies
  (path/language/team; proposed/disabled). Precedence is enforced in
  retrieval ordering + prompt wording: current user instruction >
  repository evidence > explicit memory > inferred memory — memory never
  overrides verified code truth.
- **Memory security (spec §15)**: `assertMemoryOriginAllowed` allows ONLY
  user-authored origins (manual / user-message / codemind-md /
  inbox-accept); README instructions, source comments, tool output, logs
  and commit messages can structurally never become memory.
  `assertNoSecrets` refuses credential/token/key-shaped content before any
  write. Every create/accept/disable/delete writes a `memory.change`
  AuditLog row + append-only MemoryEvent.
- **Memory Inbox (§6)**: inference (`proposeFromUserMessage`) mines ONLY
  the user's own chat message after a completed run — deterministic
  patterns for the five layers, max 3 per message — and every proposal is
  born `proposed`, visible in the new Memory console Inbox with
  [Accept]/[Reject]. Nothing auto-activates; direct activation of a
  proposed item via PATCH is rejected (409).
- **Memory vs code drift (§7)**: `checkMemoryDrift` compares every active
  memory's key terms against the REAL workspace files (160-file cap,
  term-presence + contradiction pairs, honest counts as evidence) and the
  console offers Review / Keep (audit-recorded) / Disable per finding.
- **Personal glossary (§8)**: `GlossaryEntry` CRUD + run-time resolution —
  entries whose term/alias actually appears in the query are handed to the
  model as DATA ("user says X means Y"), never as instructions.
- **CODEMIND.md recognition (§5)**: `CODEMIND.md` at the repo root is the
  one repository file whose user-authored rule lines can become explicit
  project-rule memories (idempotent sync with real `CODEMIND.md#<line>`
  evidence). README is never read by the memory engine.
- **Memory Used chip, upgraded**: chat runs now merge DB memories
  (explicit first, then accepted inferred) with the 8C worklog/changelog
  project memories; the existing chip lists each used item with scope +
  confidence + evidence and per-item disable (excluded ids are filtered
  server-side BEFORE the model sees anything).
- **Incognito run (§13)**: composer incognito toggle (no new memory from
  your messages) + Memory-panel defaults for skip-reads/skip-writes;
  incognito/reads-off runs get an honest note instead of memory records.
- **Adaptive depth (§9)**: Beginner/Standard/Expert preference +
  one-click per-run override in the composer; depth changes style only —
  security/correctness/data-loss/approval outputs are never suppressed
  (hard-coded UNSUPPRESSABLE_WARNING_KINDS).
- **Habit-based help (§10)**: computed from real chat history (tests-after-
  changes, explanation-heavy); habits only PROPOSE reusable workflows.
- **Own-concept explanation (§11)**: only concept-layer memories WITH real
  evidence refs can trigger the "same pattern as your existing flow" hint,
  and the prompt requires repository evidence to support it.
- **Memory console UI**: new "Memory" sidebar destination
  (`src/features/workspace/memory/MemoryPanel.tsx`) with Memories / Inbox /
  Drift / Glossary / CODEMIND.md / Habits tabs + run defaults.
- **V2.1 §A — repository prompt-injection defense**: `detectInjectionAttempts`
  + `renderInjectionWarning` (9 instruction-like pattern rules) surface
  instruction-shaped lines inside repo/tool data as QUOTED suspicious
  content in reasoning/critic prompts and agent findings; the fence passes
  data verbatim — never censors, never obeys.
- **V2.1 §B — tool-output defense**: `fenceToolOutput` gives tool results
  their own explicit UNTRUSTED_TOOL_OUTPUT fence; the binding preamble
  states no tool output can increase permissions, change autonomy, bypass
  approval or redefine policy — enforced in code (registry grants + engine
  approval gates read nothing from model text).
- **V2.1 §C/§F — core agents + capability rule**: the four core agents
  (Planner, Retrieval, Coder, Verifier) are first-class; `AgentCapabilityStatus`
  gains `partial`; `src/server/orchestrator/evals.ts` drives 13 REAL eval
  cases (10 implemented agents + injection/tool/memory-defense proofs,
  gateway cases honest on failure) via `POST /api/orchestrator/evals`,
  persisted as Evaluation rows, surfaced in a new Orchestrator console
  card. Capability statuses now REQUIRE a passing case.
- **V2.1 §D/§E — agent specifications**: `docs/agents/` ships the full
  11-field spec template plus specs for every implemented agent and the
  specialists prepared as `planned`: reproducer, dependency-upgrader,
  pr-review, log-analyst (registry entries added; never instantiated for
  tasks, never executed).

## [Phase 9.1 — Scroll on Send + Mandated Chain Close] — 2026-10-06

### Added
- **Scroll on Message Send** (user mandate, RULES.md §15): sending a message
  from ANY scroll position — even from far up a long conversation — now
  performs a CONTROLLED smooth scroll (distance-tuned ≈320–650ms easeOutCubic
  rAF animation, cancelled by real user wheel/touch input) that lands the
  newly sent question pinned at the viewport TOP. It is never a jump to the
  absolute bottom and never a hard cut; the anchoring probe
  (`questionVisualY ≈ 8px`) still applies. New
  `chat/activity/send-scroll-gate.ts`: `send()` arms the gate BEFORE the
  message enters the store and the run — the thought chain with it — starts
  ONLY when ConversationView's anchor effect has ARRIVED (wait bounded at
  1.5s so a hidden view can never stall a run); double-send and regenerate
  are blocked while a start is pending.
- **Thought chain close — last-row loader, then full one-shot close** (user
  mandate, RULES.md §15; explicit authorization to touch the frozen chain
  close for exactly this change): the chain now closes only after its last
  row completes; the last row carries a spinner loader for exactly 1.5s;
  when it ends the timeline closes FULLY and INSTANTLY in one shot
  (`data-full-close` disables the 300ms grid transition for that frame) —
  no gradual collapse, no half-closed state. The header keeps its live
  Thinking/Solving indicator until the close fires, so the final duration
  label lands exactly at the close moment. History views that mount
  already-final skip the loader. Chain PACING/reveal rhythm untouched.

### Verified
- agent-browser E2E against the real gateway: scrolled-to-top send in a long
  conversation → per-frame rAF samples show a smooth multi-frame scrollTop
  animation (not a jump) landing at `questionVisualY ≈ 8px`; the live
  activity chain is absent during the animation and appears only after
  arrival (gate holds); on chain completion the last-row loader shows for
  ~1.5s and the close is a single-frame height drop to 0 (no intermediate
  frames); zero page errors.

## [Phase 9 — Multi-Agent Orchestrator V2] — 2026-10-06

### Added
- **Orchestration engine** (`src/server/orchestrator/engine.ts`): the full
  spec §2 flow — Intent → Plan → Select agents → Build context → Execute →
  Validate → Critic → Response/change. Selective execution only (the plan
  decides which agents run — never every agent per question), topological
  waves with PARALLEL execution inside a wave (verified: Security +
  Dependency + Graph concurrently after Retrieval), engine-enforced
  per-agent timeouts, registry retry policies (attempt counts recorded
  honestly in spans), a global abort path for user-facing cancel, an
  approval GATE that pauses the run until a human decision (with honest
  15-minute expiry), a critic loop with ONE re-retrieval round on weak
  evidence, and start-time recovery that marks runs orphaned by a server
  restart as failed instead of leaving zombies.
- **Agent contracts + registry** (`contracts.ts`, `registry.ts`): every
  agent carries name/version/status/input+output schema/allowed tools/
  timeout/approval policy/retry policy; every execution returns the same
  AgentResult (agent, status, findings, evidence, confidence, sources,
  next_action). HONEST capability status: planner, retrieval, code-analyst,
  graph, dependency, security, git (read-only), reasoning, coding
  (propose-only) and critic are `implemented` (real tools, real persisted
  state, structured outputs, acceptance-verified); testing, documentation,
  debugger, architecture, performance, refactoring, migration, release and
  sandbox are `planned` and are NEVER silently executed (a plan that names
  them records an honest `skipped` span).
- **Tool permission layer** (`tools.ts`): every tool call passes a code
  check against the agent's registry grants (spec §4 tiers — search
  read-only, analyst read/analyze, coding read+propose, security
  static-analysis, git read-only with NO mutating grant issued to anyone).
  Violations raise `OrchestratorToolError` and surface as failed spans.
  Tools are thin adapters over the REAL services: hybrid search, workspace
  fs, read-only git service, import-graph scanner, dependency scanner.
- **Security agent static scanner** (`security-scan.ts`): pattern scan
  (hardcoded secrets, eval/Function, shell exec, SQL concat, HTML sinks,
  weak hash, CORS wildcard, insecure transport, JWT none) with exact
  path:line evidence, honestly labeled "pattern-based, not a full
  SAST/taint engine".
- **Prompt-injection defense** (`fence.ts`): ALL repository content, tool
  output and the user request enter LLM prompts inside
  `<<<UNTRUSTED_REPO_DATA>>>` fences with binding security rules; tool
  results can never elevate permissions (permissions are code-enforced).
- **Critic verification** (agents.ts + reference-verifier reuse): file
  references in answers are verified against the real workspace index,
  claims must cite existing support paths, an LLM cross-check flags
  unsupported claims/contradictions/incorrect assumptions; weak evidence
  triggers one re-retrieval, then the answer says plainly what could not
  be verified.
- **Observability** (Prisma): `OrchestratorAgentSpan` model (agent id, run
  id, wave, attempts, tool count, findings count, confidence, sources,
  error, timing) + reuse of `AgentRun` (kind "orchestrator") and
  `Approval`. Metadata only — never tokens, credentials, or repository
  content in logs.
- **API**: `POST /api/orchestrator/run`, `GET /api/orchestrator/runs/[id]`
  (poll full state), `POST .../cancel`, `POST .../approve` (records the
  human decision — applying a change-set does NOT exist on disk in this
  phase), `GET /api/orchestrator/runs` (recent runs).
- **Orchestrator console UI** (`OrchestratorPanel.tsx` + workspace nav
  entry): one-click acceptance presets, live trace chips (Planner ✓
  Retrieval ✓ … — high-level status only, NEVER internal reasoning),
  per-agent findings/evidence accordions, critic verdict card, approval
  banner with Approve/Reject, final answer + proposed change-set view,
  honest agent registry table (implemented/planned), recent-runs list.
- **Verified (11/11 acceptance scenarios)**: simple question, search
  question, architecture question, security question, coding task,
  multi-agent task (parallel waves confirmed in span data), failed agent
  (drill), timeout (drill), retry (drill — attempts=2 recorded), cancel
  (mid-run), approval (approve → recorded + change-set stays proposed;
  reject → change-set discarded; disk untouched in both cases). Gateway
  429 outage during testing degraded honestly (planner heuristic fallback,
  failed spans recorded, no fabricated results). Lint: 0 errors.

## [Phase 8.75 — AI-Native Inline Completion + Cmd/Ctrl+K Inline Edit] — 2026-10-05

### Added
- **Inline completion (§1/§2/§6)**: a real Monaco `InlineCompletionsProvider`
  (`inline-ai/inline-completion.ts`) connected to the LLM Gateway via
  `POST /api/ai/inline-complete`. Context = current file around the cursor,
  nearby text-scan symbols, open tabs, real recent-edit records, current
  selection, and a real RULES.md excerpt read server-side. Tab accept +
  word-by-word partial accept (Ctrl/Cmd+Right) + Escape hide are deterministic
  (re-bound native commands), every request is cancellable (provider token +
  AbortController + typing aborts the superseded request), a strict
  stale-guard (model version id) guarantees an obsolete completion is NEVER
  inserted after the buffer changed, LRU cache keyed by (model, version) with
  in-flight dedup, short negative window on gateway failures, retry via the
  "Inline AI: Retry Completion" palette action. Large files skip the feature
  (perf budget). Honest measurement: user-perceived latency (request → ghost
  text) recorded per show — `window.__cmxInlineAI.stats()` reports
  counts + p50/p95. MEASURED in this environment: p50 ≈ 0.8–1.0 s (chat-model
  transport) — the 300 ms target is NOT claimed; per §6 it holds only where
  the environment supports it.
- **Cmd/Ctrl+K inline edit (§3/§4)**: select code → Ctrl/Cmd+K → instruction
  input (content widget) → `POST /api/ai/inline-edit` → proposed edit rendered
  as an INLINE LINE DIFF in a view zone below the selection with
  Accept / Reject. SHADOW BUFFER: the proposal is preview-only; Accept writes
  to the IN-MEMORY Monaco model via executeEdits — and this build has no
  disk-write path at all (verified: zero write endpoints + post-accept reload
  shows the original file). Escape rejects, Ctrl/Cmd+Enter accepts, any
  buffer change invalidates a stale proposal. Ctrl/Cmd+K inside the editor
  now routes to this action (the app-level palette handler yields inside
  Monaco; palette stays available outside).
- **Hinglish hover (§5)**: an honest text-scan hover (kind/name/line, labeled
  "not a language server") with an "Explain in Hinglish" command link for
  text-scan symbols; opens an overlay peek that explains the symbol via
  `POST /api/ai/explain` through the SAME gateway/context infrastructure.
  Close button + Escape; never edits the buffer.
- **Latency honesty (§6)**: p50/p95 measured from real shows; per-response
  gateway latency surfaced by the service; CAPABILITIES.md row states the
  measured reality.

### Verified
- agent-browser E2E (real gateway runs): automatic triggers on real typing
  (triggerKind Automatic ×N), ghost text shown ×4, Tab accept inserted the
  suggestion (accepts=1), Ctrl+Right partial accept (partialAccepts=1, ghost
  continues), Escape dismissed, typing invalidated in-flight requests
  (cancellations climbing, superseded guard in code), cache hit on
  same-version re-invocation (cacheHits=1); Ctrl+K flow twice (Reject →
  buffer unchanged; Accept → comment applied to the in-memory buffer, tab
  shows "unsaved (in-memory)"); reload restored the ORIGINAL file (no disk
  write anywhere); hover → "Explain in Hinglish" → peek with a real Hinglish
  explanation; retry + edit actions present; 360px clean; zero page errors.

## [Hotfix 8.5.1 — Restore "Pin User Message to Top / Scrolling Anchoring"] — 2026-10-05

### Fixed
- **Send anchoring restored (user-mandated protected feature, RULES.md §15)**.
  Phase 8.5's `content-visibility: auto` + `contain-intrinsic-size` on chat
  message wrappers reported placeholder heights (320px) for off-screen rows,
  silently corrupting the anchor math (`offsetTop` / `scrollHeight`) in long
  conversations — the just-sent question landed 793px below the viewport top
  instead of the designed 8px, so the pin-to-top behavior appeared removed.
  The placeholder sizing is REVERTED: message wrappers keep real layout again.
  Verified: `questionVisualY = 8px` after send, anchor-hold during generation
  (view never moves while the answer grows below), designed silent spacer
  collapse at terminal, spacer path on fresh conversations, instant-bottom
  conversation-switch rebase.
- **Never again**: the scroll choreography block now carries an in-code
  PROTECTED banner, and RULES.md §15 (Protected UX Features) forbids removing
  or altering the anchoring contract and forbids placeholder-sizing/virtualized
  rows on chat message wrappers without re-running the anchoring probe.

## [Phase 8.5 — Response Engine V2 + Verified Code Rendering + Multimodal Output] — 2026-10-05

### Added
- **Response pipeline (backend)**: Draft → Structured Output (a real second
  gateway call distills the streamed answer into typed JSON) → Reference
  Verifier (every file path / line range / symbol checked against the Phase 7
  search index — real files, real line counts via `contentOf`, real symbol
  table) → Critic (rule-based completeness + consistency checks with
  human-readable findings) → Refine (unverified "Confirmed" claims downgrade
  to "Likely" with an honest note; overall uncertainty derived from the claim
  set) → Render. Runs AFTER the answer streams; never alters the answer text.
- **Typed structured contract** (`StructuredResponse`): summary, claims
  (EvidenceBackedClaim), files/symbols (verified|unknown), code metadata,
  actions, sources, overall uncertainty, followups, memoryUsed, verification
  stats. New wire event `RESPONSE_STRUCTURED` (additive) + activity row
  "Verifying response".
- **ResponseView (UI)**: template strip (Explain TL;DR→Flow→Key files→Gotchas;
  Debug root cause→evidence→fix→verify; Review findings→severity→fix;
  Architecture graph→components→relationships), typed summary card, claims
  with clickable uncertainty badges (Confirmed/Likely/Potential/Unknown — each
  reveals its evidence), verified file chips (clickable via
  EditorNavigationService ONLY when verified) vs "Unknown Reference" badges
  (plain text, never a false link), verified/unknown symbol chips, followup
  chips that load into the composer draft, overall uncertainty strip, and a
  verification footer with critic notes.
- **Code block v2 (AICodeBlock)**: header now carries filename · language ·
  line range · status (Generated/Modified) + "Unknown file" badge for
  unverified filenames; word-wrap toggle; line numbers + structured line
  highlighting; worker-based token highlighting for long blocks
  (`highlight.worker.ts`, dependency-free tokenizer; plain-text fallback).
  Existing copy/download/preview/open-in-editor/diff/expand kept.
- **Tables (MarkdownTable)**: GFM tables via `remark-gfm` (dependency
  addition per RULES §6), sticky header, internal horizontal scroll only,
  Copy as Markdown / Copy as CSV toolbar.
- **Diagrams (MermaidBlock)**: `mermaid@11` (dependency addition) rendered
  with securityLevel "strict" (static SVG, no external network, no click
  handlers); ANY failure falls back to the real code block with an honest
  note.
- **Multimodal capability honesty**: new `GET /api/assistant/capabilities`
  reports the MEASURED transport truth (image understanding: unsupported —
  the gateway message contract is text-only today). The composer's image
  button is capability-gated with the honest reason; session-file
  attachments that do reach the backend produce an explicit "cannot see
  images" instruction to the model — never a claimed analysis.
- **Memory chip labels**: "Memory used: <scope>, <scope>" naming what was
  used (count fallback), with the existing source/evidence popover.

### Performance
- Streaming-safe memoized block rendering. (The `content-visibility: auto`
  render-skipping added here was REVERTED in Hotfix 8.5.1 — it corrupted the
  protected send-anchoring math; see the hotfix entry above.)

## [Phase 8D — Real-Time AI Thinking + Solving Activity Chain] — 2026-10-04

The old assistant thought UI is replaced with a production-quality, real-time
activity chain driven by the EXISTING Phase-8 sequenced events through a thin
adapter + per-run external store. No second event system; no fake activity;
no private chain-of-thought; titles come only from fixed templates.

### Added
- **Per-run activity store** (`src/features/workspace/chat/activity/`):
  `useRunActivity(runId)` over `useSyncExternalStore`; idempotent ingestion
  (duplicate seq ignored, stale seq never overwrites newer row state,
  malformed events dropped at the boundary); one rAF-batched flush per frame
  so a new event in one run never re-renders the chat or other runs; copy-
  on-write rows keep snapshots stable for memoized rendering.
- **Deterministic phase machine**: default `thinking`; the FIRST real
  mutating/executing activity (create/edit/delete/rename file, command,
  test) transitions to `solving` — never back; waiting (approval/question)
  pauses the run; the FIRST final-answer chunk closes the work phase
  (the answer may still be streaming); first terminal event finalizes
  (completed/failed/cancelled).
- **ONE run-level active-work timer** (spec A.7): performance.now() with an
  explicit paused-duration accumulator; waiting time is EXCLUDED; the timer
  is continuous across Thinking → Solving; never finalized while paused
  (chunk/terminal events resume first — race-safe).
- **Duration formatting** (spec A.8/A.9): `<1s` (never a false 1s), `Ns`
  under a minute, `Xm Ys` at/over a minute; final labels exactly
  `Thought for Xs` / `Worked for Xs` / `Failed after Xs` / `Stopped after Xs`.
- **UI** (`src/components/ai-activity/`): the exact supplied 3×3 lattice
  (6px cells, 2px gap, .15/1 opacity, 648ms cycle, reference delays and
  cubic-bezier(.77,0,.175,1)) + shared shimmer; the compact Solving
  indicator (22px visible orb + 14px label + 8.75px gap — NO pill, NO
  background, NO shadow, NO 74px container) lazy-loading the project's own
  vendored solving-orb canvas (pinned local dependency, never an @main CDN)
  ONLY when a run reaches Solving, with a 22px CSS fallback orb for
  reduced-motion/import failure; 150ms cross-fade in a shared shell with a
  22px min-height header (no layout jump); collapsible timeline
  (grid-rows 0fr→1fr, ~300ms ease-out, rotating chevron M6 3l5 5-5 5);
  collapsed content is INERT; one polite live region announcing state
  changes only; status dots (accent pulse / secondary / error / muted /
  attention); ~40vh running cap with newest-follow scrolling; 200-row
  render cap with an "Earlier steps" expander; 4+ consecutive same-kind
  operations merge into grouped rows ("Read 12 files", "Edited 8 files");
  real file rows navigate via the shared EditorNavigationService; search
  children show only really-returned files; middle-ellipsis for long paths
  with the full path in title.
- **Secret redaction before render** (`activity/redact.ts`): API keys,
  bearer/Authorization tokens, JWT/gh/xox token shapes, credential URLs,
  `password=`/`--token`/`.env` assignments, control-character stripping and
  field caps — reusable, applied inside the adapter.
- **Persistence**: the final chain (`PersistedActivityChain`) is stored on
  the chat message, so a reload keeps `Worked for 24s`-style labels and the
  completed, still-expandable timeline; pre-8D history renders through the
  same presentation from its recorded steps.
- **Verification harness** (`window.__cmxRunActivity`): snapshot/ingest/
  resume/debug surface used for browser-driven verification of the phase
  machine, dedup and timer (production UI ingests real wire events only).

### Changed
- `AssistantMessage` no longer renders the old "Assistant" heading/status
  presentation or the duplicate wall-clock duration chip; the activity chain
  IS the message header. `use-assistant-run` feeds every sequenced wire
  event into the per-run store and persists the final chain at the terminal
  event; `thoughtForMs` now carries ACTIVE work time (waiting excluded).
- `ThinkingOrb` gains one additive export (`drawOrbFrame`) so the supplied
  solving animation has a single source of truth; the component's behavior
  is unchanged. `types/contracts.ts` gains the additive VIEW type section
  (no existing type changed).

### Honest limits
- Solving appears only when a real mutating/executing activity arrives — the
  current backend (pre-8.5) performs no file mutations, so honest runs end
  `Thought for Xs`; the solving path is verified with synthetic events
  through the documented harness.
- The approval card is emitted only when the model actually emits the
  protocol block (stochastic); post-finalize approval renders as a
  "Waiting for approval" timeline row while the header keeps the final
  duration.
- Automated unit-test files were not added in this sandbox (no-test-code
  workspace constraint); correctness evidence is browser E2E + harness
  probes recorded in `worklog.md`.

## [Phase 8C — Context Inspector + Approval Card + Question Flow] — 2026-10-04

Context is inspectable, approval is actionable, questions pause execution.
All data is measured truth — no fabricated context items, no fake impact
graph, no silent re-inclusion of removed refs. NON-GOALS respected: no code
mutation, no autonomous agent, no real ChangeSet application (approval
decisions are recorded, never applied).

### Added
- **Context Inspector panel** (chat panel, collapsible): the measured truth
  of what a run received — files, chunks (real byte ranges incl.
  budget-capped slices), symbols (real search symbol hits), retrieval
  source + reason per entry, honest token estimates (chars ÷ 4, always
  labeled "estimate"), configured context budget (96k chars ≈ 24k tok est.)
  with a usage bar, memory items, pinned and removed counts. New wire event
  `CONTEXT_SNAPSHOT` carries the per-run snapshot (engine-recorded,
  message-persisted, exposed via `window.__cmxAssistant.lastContextSnapshot()`).
- **Context controls** per entry: pin (pinned files are read in full on
  every run — enforced server-side as pinned reads with FILE_REFERENCED),
  remove (refs are filtered from retrieval server-side; the search activity
  reports "N hidden by your context filters" — a removed item NEVER
  silently returns; restore is always explicit), open (EditorNavigationService),
  replace (re-read from disk; next run uses current file state), inspect
  (chunks/symbols/char detail). Ledger travels with every run
  (`excludedRefs`/`pinnedRefs`/`excludedMemoryIds` on the run payload).
- **Memory Used** (real retrieval over the project's persistent memory per
  RULES §5 — worklog.md + CHANGELOG.md): "Memory used: N" chip on
  assistant messages + in the inspector; reveal shows memory type
  (tier), content, scope, source, confidence (derived from real term-match
  strength), evidence anchor (file#anchor) and the matched terms. Each
  memory can be disabled for the request — disabled ids are sent with the
  run and filtered BEFORE anything reaches the model. New wire event
  `MEMORY_USED`. Retrieved memories genuinely inform the preamble (tier 3,
  never overrides repository evidence).
- **ApprovalCard** (native CodeMind reconstruction of the 21st.dev
  reference, `src/components/ai/ApprovalCard.tsx`): shows what will happen,
  why, affected files (click → editor), risk badge, permission, expected
  tests, security impact — with Review (expand details), Approve, Reject
  and Edit (opens affected files) actions; decision banner states honestly
  that ChangeSet application is not connected and nothing was modified.
  Driven by a real model protocol: in code/agent mode the model is
  instructed to end proposals that modify files with a
  ```codemind-approval-request JSON fence; the backend parses it (with a
  tolerant fallback), strips it from the displayed answer, and emits
  `APPROVAL_REQUIRED`. No block → no card (nothing fabricated).
- **BlastRadiusSlot** (`src/components/ai/BlastRadiusSlot.tsx`): reserved
  visual area inside the approval card for Phase 10/15 impact data — four
  typed slots (changed modules / affected APIs / affected tests / security
  dependencies), each honestly "no data yet". No fake graph.
- **Question flow (pause → ask → resume)**: when the request implies a
  modification and REAL hybrid-retrieval finds multiple files with
  comparable relevance (runner-up ≥ 60% of the leader's score, floor 0.08),
  the run pauses and asks ONCE as a batch (`INTAKE_QUESTIONS_REQUIRED`) —
  "I found N matching implementations for this change. Which one should I
  work with?" with the real candidate files as options (plus custom text).
  The stream stays open; `POST /api/assistant/runs/answers` delivers the
  answers through a globalThis-registered pending map (Next.js compiles
  per-route module graphs — module state is not shared across routes), the
  engine flips to "awaiting-answers" and back, the answers join the user's
  message, and the run completes. Client disconnect / 10-minute timeout
  cancels the paused run honestly. Skipped when the query already names an
  explicit repo path (the user already decided) or no material ambiguity
  exists.

### Changed
- Assistant contracts → `2.1.0-phase8c` (additive only): `MemoryRecord`
  (+scope/confidence/evidence/matchedTerms), `ApprovalRequest`
  (+expectedTests/securityImpact), `ContextInspectorEntry`
  (+label/charCount/tokenEstimate/chunks/symbols), `ContextInspectorSnapshot`
  (+budget/token/memory fields), `ContextInspectorSource` +`"pinned"`,
  `RunStatus` +`"awaiting-answers"`, new `IntakeAnswer` /
  `MemoryConfidence` / `ApprovalDecision` / `ContextChunk` types,
  `CONTEXT_BUDGET_*` constants, `APPROVAL_MARKER`.
- ActivityEngine records contextSnapshot/memories/approvals/questionBatch,
  accepts activity events while paused (implicit resume), rejects nothing
  it did not before; run metrics outcome includes "awaiting-answers".
- Retrieval runs in search AND code/agent modes (not loop) — real Phase 7
  hybrid search drives context, intake ambiguity and the snapshot.
- `updateMessage` store patch extended (firstEventMs/thoughtForMs gap fixed
  additively); ChatMessage persists runId/contextSnapshot/memories/
  questionBatch/intakeAnswers/approval/decision.
- Fixed: assistant usage rows no longer write the wire runId into
  `usage_records.runId` (DB-level FK → agent_runs.id made every streamed
  run's usage insert fail); correlation stays on requestId.
- Fixed (8B baseline): runs-route `writeEvent` typed against the unseq'd
  event union — removes 8 baseline tsc errors.

## [Phase 8B — Activity Engine + Lattice Loader + Thinking Orb + Thought Chain] — 2026-10-04

The user-visible execution activity engine. Privacy boundary enforced by
construction: only safe execution summaries ("Understanding request",
"Searching repository", "Reading files", "Composing response") travel on the
wire and render in the UI — never hidden model reasoning, private
deliberation, or secret prompts. NON-GOALS respected: no approval logic, no
autonomous Loop logic, no chain-of-thought exposure.

### Added
- **Streaming run surface** `POST /api/assistant/runs`: one real assistant
  turn streamed as the 8B event contract — every wire event carries a
  monotonic per-run `seq` (RUN_STARTED → ACTIVITY_STARTED/UPDATED/COMPLETED →
  SEARCH_RESULT → FILE_REFERENCED → RESPONSE_CHUNK → `result` frame →
  RUN_COMPLETED / RUN_FAILED; RUN_CANCELLED recorded on client disconnect).
  RUN_STARTED is written synchronously at stream open (measured server-side
  ~0ms; client-measured first-event latency 54–86ms, target ≈300ms).
- **Real backend activity** (assistant-service `onStage` emitter, additive —
  POST /api/ai/chat behavior unchanged): "Understanding request" (mode +
  message count), "Searching repository" (REAL Phase 7 hybrid retrieval in
  search mode — SEARCH_RESULT with hits/topFiles; top file paths attached as
  repository-retrieval preamble facts), "Reading files" (server-side
  attachment re-reads with FILE_REFERENCED), "Composing response" (served
  model + measured latency). APPROVAL_REQUIRED/QUESTION_REQUIRED stay
  defined-but-never-emitted (honest: no approval logic exists yet).
- **Category engine** (`category-engine.ts`): selects only the categories a
  run actually used (Steps/Search/Coding/Testing/Security/Git/Architecture/
  Deployment), maps engine ActivityNodes → Odyssey chain steps, merges real
  SEARCH_RESULT/FILE_REFERENCED facts as children, and renders the measured
  "Thought for Xs" completion label. "Deployment" added additively to the
  category + ActivityKind vocabularies.
- **LatticeLoader** — reference-exact native reconstruction: 3×3 grid
  (6px cells, 2px gap), staggered delays 90/180/270/0/90/180/90/180/270ms,
  `lattice-on` keyframes (idle .15 → peak 1, 648ms cycle), and the reference
  rAF stopwatch (`<LatticeLoader label="Thinking" startedAt={…} />` shows
  measured "X.Xs"). Reduced motion → static diagonal, timer keeps counting
  (text, not motion); role="status"; pauses when hidden; full cleanup.
- **ThinkingOrb "solving"** — canvas reconstruction of the supplied
  `createThinkingOrb` reference: 74px dark pill, 56px visible orb (64px
  canvas), theme dark, variant classic, speed 1, non-interactive, rendered
  behind `<ThinkingOrb state="solving" label="Solving…" />`. Self-contained
  canvas logic (never spreads into chat code), DPR ≤ 1.5, pauses when
  hidden/offscreen, static frame under reduced motion, full unmount cleanup.
  Classic idle/thinking/done path unchanged.
- **ThoughtChain (Odyssey)** — vertical rail + icon + connector, trigger +
  chevron expand/collapse, active shimmer, "In progress" badge, child
  detail rows (✓/●/○ safe execution facts like `read_file src/… ✓`). The
  ACTIVE step starts expanded; completed steps start collapsed unless the
  user opens them; pending steps stay flat. `collapsible={false}` keeps the
  flat legacy chain.
- **Live run view** (ConversationView): the busy message renders the
  engine-driven chain; LatticeLoader "Thinking" until the first activity
  completes, then the canvas orb "Solving…". On completion the message
  persists the real chain + measured chips: "Thought for Xs", "first event
  Xms", mode, and the gateway-served model.
- **Run metrics** (run-adapter + `window.__cmxAssistant.lastRunMetrics()`):
  measured first-event latency, event count, last seq, sequence gaps
  (transport frame accounted), engine duration, relevant categories, and
  outcome. Browser-verified run: `{firstEventMs: 53.8, events: 13,
  lastSeq: 14, seqGaps: 0, durationMs: 5083, categories:
  ["steps","search"], outcome: "completed"}`.

### Verified (agent-browser, desktop + 360px)
- Live chain: ✓ Understanding request → ✓ Searching repository (expanded:
  "14 relevant results" + real top-hit children) → ● Composing response
  IN PROGRESS → completion chips.
- Cancel mid-run: message honestly "Stopped"; "Composing response" stays
  in-progress in the persisted chain (it never completed); Regenerate works.
- 360px: no horizontal overflow; chips wrap. Console: zero errors.

## [Phase 7 — Hybrid Search + Hindi/Hinglish] — a real search engine for the workspace

## [Phase 8A — Advanced AI Composer + Mode System] — 2026-10-04

V2.1 ADDITIONS carried in the same phase: memory-aware pipeline contract,
intake question batching, evidence-backed uncertainty vocabulary, and Context
Inspector snapshot types (all contract-level; their dedicated UIs stay with
8B/8C/later phases per the partition).

### Added
- **LLM Gateway** (`src/server/llm/llm-gateway.ts`): the ONLY module allowed
  to import a model-provider SDK. Real model catalog with measured truth
  (the transport serves `glm-4-plus` for all chat ids today — the catalog
  says so instead of advertising a fake multi-model switcher), honest
  `servedModel` reporting per completion, 60s hard timeout, typed
  `LLMGatewayError`. New `GET /api/llm/models` serves the catalog to the UI.
- **Composer modes** (8A §1/§4): Search / Code / Agent / Loop as a segmented
  control integrated INTO the text input. Every request serializes
  `mode` (typed backend zod enum); the assistant system prompt applies an
  honest per-mode contract (Agent/Loop state plainly that autonomous
  execution/looping are not connected — no pretended multi-step behavior).
- **Composer input surface** (8A §2): multiline input, send, stop, cancel
  (toolbar Stop + global Esc when a run is in flight), regenerate,
  attachments, current-file/selected-code context, model selection through
  the LLM Gateway, context selection popover (repository / branch / current
  file toggles with real values; selected code honestly shown as "—" until a
  live selection tracker exists).
- **Attachments below the text field** (8A §3): repository-file attachments
  are picked from the REAL workspace tree (`/api/repository/tree`, 60s TTL
  cache, ≤80 rendered rows) and render as shared `FileReferenceChip`s whose
  click routes through the EditorNavigationService. A filename that cannot
  resolve is never displayed; unresolvable server-side reads are reported
  honestly to the model (never invented).
- **Backend attachment reality**: repository-file attachments are re-read
  server-side via the allowlisted `readWorkspaceFile` (≤3 files, 6k chars
  each) — the model answers from real file content (verified: correct
  `build` script answer from the actual `package.json`).
- **Keyboard** (8A §5): Enter send, Shift+Enter newline, Alt+1..4 mode,
  Alt+M cycle, global Esc stops a running completion. Command Palette adds a
  "Composer" group: 4 mode commands, cycle mode, attach file (opens the
  picker), cancel run (enabled only while generating), regenerate (enabled
  when the last message is an assistant reply).
- **Run meta honesty**: assistant messages display the issued mode and the
  model the gateway ACTUALLY served (from the response payload), as chips.
- **V2.1 contract additions** (`assistant/contracts.ts`, additive):
  extended `PIPELINE_STAGES` (+ task-contract, memory-retrieval,
  context-inspector, verification), `MEMORY_PRECEDENCE`
  (current user instruction > repository evidence > saved explicit memory >
  inferred memory) with `MemoryRecord`/`MemoryRetrievalOutcome`,
  `TaskContract`, `IntakeQuestionBatch` + `INTAKE_QUESTIONS_REQUIRED` event,
  `UNCERTAINTY_LEVELS` (Confirmed/Likely/Potential/Unknown) +
  `EvidenceBackedClaim`, `ContextInspectorSnapshot` types, and the
  `ComposerModelSlot`/`GatewayModelDescriptor` evolution for the real
  gateway catalog. Memory-precedence and uncertainty-vocabulary instructions
  are live in the assistant system prompt.
- **Responsive** (8A §7): composer verified usable at 360px with zero
  horizontal overflow (`scrollWidth === 360` measured).

### Changed
- `POST /api/ai/chat` wire contract (additive): optional `mode`, `model`,
  `context.selectedCode`, `context.attachments`; success response now also
  echoes `mode` + `servedModel`. Unknown gateway model ids fail honestly.
- `assistant-service.ts` routes ALL model access through the LLM Gateway
  (pre-8A conversation wire shape preserved: one assistant preamble +
  history — the transport rejects consecutive assistant messages).

### Non-goals respected
Activity Engine UI (8B), approval engine, autonomous loop, response
renderer (8.5), coding mutation — none implemented.

### Added
- **Hybrid retrieval engine** (`src/server/search/`): BM25 lexical (k1=1.4,
  b=0.72, idf-weighted inverted index over file + symbol-name units) +
  **local dense vectors** (feature-hashed unigram/bigram embeddings, 384-dim,
  L2-normalized, cosine — the platform SDK exposes no embedding endpoint and
  the UI labels this honestly) + symbol table + path relevance + import-graph
  relationships (resolved relative/`@/` edges → callers/callees) + git context
  (branch, porcelain status, recent commit paths) + metadata filters.
- **Fusion**: Reciprocal Rank Fusion (k=60, per-method priors) followed by
  Maximal Marginal Relevance diversification (λ=0.72). Never a single method.
- **Result model (spec §5)**: file, symbol, line start/end, real snippet,
  language, display-normalized score, `retrievalMethod[]` and `whyMatched[]`
  — computed explanations ("symbol name contains 'editor'", "semantic
  similarity 0.14 (local hashed n-gram vectors)", "imports X (line 18)").
- **Hindi/Hinglish normalization (spec §9)**: curated stopword + marker
  lexicon, intent rules (flow / location / call-sites / files / definition /
  tests / configuration), domain phrasing (backend→server/api…), technical
  identifiers preserved verbatim, honest interpretation notes surfaced in the
  UI. English queries pass through untouched.
- **Contextual search (spec §10)**: "iske callers dikhao" resolves the
  anaphora to the ACTIVE file/symbol (context toggle in the panel), traverses
  the real import graph and boosts explicit callers/callees results.
- **Search modes (spec §2)**: hybrid (auto), natural-language, semantic,
  keyword, exact, symbol, filename, regex, api, dependency, git, security,
  documentation — the backend understands when hybrid retrieval applies.
- **Code-aware index (spec §4)**: functions, classes, methods, components,
  hooks, imports, exports, routes, API calls, database queries, environment
  references, configuration keys, tests, documentation blocks — from the
  shared deterministic structure scanner (same engine as the client parse
  worker). In-memory cache invalidated by a (path, mtime, size) tree
  signature; index stats API reports honest build numbers.
- **Search UI (spec §6/§7)**: mode selector, filters (language, path, scope,
  current-file context), activity strip ("Searching repository — …", "N
  relevant results", top files — safe summary only), results grouped by file
  in compact rows with why-matched chips and relevance bars; clicking a hit
  opens the actual file, activates the tab, jumps to the line and highlights
  the match via the EditorNavigationService; the query is preserved across
  navigation (session store).
- **Evaluation hooks (spec §11)**: `POST /api/search/evaluate` runs a real
  judgments dataset against the live engine and computes Precision@5,
  Recall@5, MRR, NDCG@10 and per-query latency; results persist as
  `Evaluation` rows (kind `search-quality`). Before any run the API answers
  exactly **"Evaluation not run."** Measured baseline: NDCG@10 0.349, MRR
  0.617, mean latency ≈ 3 ms.
- **Search activity** persists real `Activity` rows (kind `search`) — the
  user-visible execution summary, never model reasoning.

## [V2.1 ADDITIONS — AI-native editor foundations] — model manager, tree-sitter worker, navigation history, perf budgets

### Added
- **§A EditorModelManager**: Monaco model reuse via URI, LRU disposal (never
  dirty/attached buffers), memory stats, large-file policy (>512 KB flag, 6 MB
  ceiling), dirty-buffer persistence to sessionStorage and honest restore
  after reload; dirty edits now survive tab switches (fixed the @monaco-editor
  model-dispose/clobber gap).
- **§B Parse worker**: REAL tree-sitter (web-tree-sitter@0.25.10 +
  tree-sitter-wasms, ABI-verified) running in a module worker — symbols,
  structure and outline parses off the main thread; deterministic structural
  scanner fallback with the actual engine labeled in every response. Large
  files are NEVER parsed on the main thread (>32 KB goes to the worker).
- **§C Navigation history**: back/forward stacks over real navigation
  payloads (Alt+←/→), recent locations, localStorage bookmarks, go-to-test
  that verifies candidate test files against the real tree first.
- **§D Capability honesty**: `language-capabilities` model + CapabilityBadge
  (Definitions/References: LSP unavailable; Symbols: tree-sitter|structural
  scan by the engine that actually ran; Diagnostics: editor-native analysis
  for TS/JS). Nothing shows as verified when only a placeholder exists.
- **§E Performance budgets (measured)**: ring-buffer metrics + PerfHUD.
  Measured in Chromium: keystroke p50 1.6 ms / p95 9.3 ms (budget 16 ms);
  5 MB file through the real large-file path in 92–123 ms (budget 1000 ms).
- **§F Terminal foundation**: xterm.js dock panel behind a TerminalAdapter
  contract; the reserved SandboxTerminalAdapter states the truth (no exec
  backend yet). Stack traces resolve REAL file:line references through the
  EditorNavigationService (sourceContext "terminal") — works today.
- **§G Debug adapter foundation**: DAP-shaped contracts, factory registry
  anchor, honest capability probe. Debugging is explicitly deferred to the
  editor-overlay phase; nothing is simulated.

## [Phase 6 — Monaco Code Intelligence Workspace] — real editor, navigation, diagnostics, AI code actions

### Added
- **V2.1 §A — EditorNavigationService routes**: `openFile(path)`,
  `openRange(path, startLine, endLine)`, `openSymbol(symbolId)`,
  `openSearchResult(resultId)`, `revealSelection(selection)` — the only
  supported routes for programmatically opening files. Symbol outlines and
  search results publish REAL resolved targets into typed registries
  (`registerTargets`); unknown ids fail honestly (`not-found`).
- **V2.1 §B — shared FileReferenceChip**: ONE file-reference component used
  by AI chat attachments, Code Search results (fuzzy `<mark>` highlights
  included) and future approvals/timelines/test-failures/security findings.
  Clicking always routes through the EditorNavigationService and surfaces the
  Assistant workspace when opened from another destination.
- **V2.1 §C — shared file state vocabulary**: `SharedFileState`
  (clean/modified/staged/added/deleted/conflicted/locked/read-only) +
  `FILE_STATE_META`; chips render a state dot only when the state is actually
  known — never inferred client-side.
- **V2.1 §D — future panel anchors**: editor dock registry
  (`EDITOR_DOCK_PANELS`) with REAL Problems + Terminal anchors and reserved,
  honestly-labeled Context Inspector / Git Timeline slots; CodeLens provider
  anchor exported in code-intelligence.ts. Future panels add ONE registry
  entry — no redesign.
- **Monaco editor (spec §1)**: self-hosted `monaco-editor@0.57` under
  `public/monaco/vs` (no CDN); syntax highlighting, language detection, line
  numbers, folding, selection, policy-based minimap, breadcrumbs, multi-tab,
  split editor (two panes with independent active tabs), find/replace with
  regex, go-to-line, quick outline. Warm "codemind-dark" theme matches the
  design tokens. Buffers are editable IN MEMORY with an honest
  "unsaved (in-memory)" dirty indicator — file writes arrive in a later
  phase and no save is faked.
- **Keyboard commands (spec §2)**: Ctrl/Cmd+P (files palette, existing),
  Ctrl/Cmd+Shift+F (Code Search), Ctrl/Cmd+G (go-to-line) and
  Ctrl/Cmd+Shift+O (quick outline) mapped to real commands via the
  `cmx-editor-command` event contract; Monaco-native bindings stay primary
  inside the editor.
- **Code intelligence (spec §3, honest)**: REAL text-scan symbol outline
  (regex over actual content; TS/JS/Python/JSON) registered as a Monaco
  document-symbol provider AND published to the navigation registry; the
  intelligence panel Symbols section is now real and labeled "text scan".
  Definitions/references/callers/callees and tree-sitter symbols report
  `available:false` with reasons — no fabricated language intelligence.
- **Inline diagnostics (spec §6, honest)**: REAL single-file syntax
  diagnostics from Monaco's TS/JS workers (semantic validation intentionally
  disabled — no cross-file resolution, so no artifact "errors"); the
  Problems panel lists markers with severity counts and click-to-navigate;
  Lint/Type/Security/AI categories render as [PLANNED] slots.
- **Git-aware editor (spec §4)**: `git-diff.ts` (real
  `git diff --unified=0` hunk parsing + `git show HEAD:` baseline) and
  `git-blame.ts` (real `--line-porcelain` grouped into ranges) +
  `GET /api/repository/file-diff` / `GET /api/repository/file-blame` (legacy
  envelope, audits, never throw). Editor header gains Diff (real Monaco
  DiffEditor vs the committed baseline) and Blame (inline author·date tags)
  toggles; changed-line gutter decorations auto-load for git-modified files.
- **Selected-code AI actions (spec §5)**: a floating toolbar over non-empty
  editor selections — Explain, Review, Fix, Refactor, Optimize, Generate
  Tests, Generate Documentation, Security Review, Ask AI — queues the EXACT
  selected text + location into the composer; the code becomes real AI
  request context embedded in the message (selection attachment included).
- **AI code blocks (spec §7/§8)**: `AICodeBlock` replaces the Phase 2 block —
  header copy/download/expand plus CONTEXTUAL footer actions only:
  Open in Editor (with `// file:` reference → that file; without → an honest,
  clearly-badged GENERATED scratch tab), Preview (only HTML/CSS/JS/JSX),
  Review Diff (real DiffViewer of loaded file vs snippet) and Apply (disabled
  with the honest reason — writes arrive later).
- **Sandboxed preview (spec §9)**: previews render inside
  `<iframe sandbox="allow-scripts">` (no same-origin — generated code never
  touches the app); JSX is transformed client-side with Sucrase and React 18
  loads from esm.sh inside the sandbox; failures surface in an honest
  on-frame error overlay.
- **Diff system foundation (spec §10)**: `diff-contracts.ts` —
  `ChangeOperation`, `FileChange`, `DiffHunk`, `GitFileDiff`, `BlameRange`,
  `GitFileBlame` — plus the shared `DiffViewer` (Monaco DiffEditor, honest
  empty-side notes) consumed by code blocks, the editor diff toggle and
  future AI coding phases.
- **Large-file performance (spec §11)**: files > 4000 lines or > 200 KB
  disable the minimap and smooth animations; verified with a real 5000-line
  432 KB source file opened from the explorer without freezing.

### Verification record
- Monaco renders real repository code (page.tsx, package.json, generated
  HTML) with tab strip, breadcrumbs, metadata header; dirty dot + header
  badge appear when the buffer is edited and vanish after reload (honest
  in-memory semantics).
- Selection toolbar → composer draft verified end-to-end: prompt + exact
  selected code + `File: path:2-5` + selection chip.
- Ctrl+G opened Monaco goto-line; Ctrl+Shift+O listed real symbols ("Home");
  Ctrl+Shift+F switched to Code Search; Ctrl/Cmd+P files palette unchanged.
- Problems panel listed a real TypeScript syntax error ("Property assignment
  expected", 1 error) and click navigated the editor to the line.
- Diff toggle rendered the real side-by-side diff vs HEAD; blame showed the
  real author/date tags; navigation from a Code Search chip landed in the
  editor with the file active.
- Preview dialog confirmed `sandbox="allow-scripts"` and rendered the
  generated button in isolation; AI chat produced a real HTML snippet with
  contextual actions only (no Diff/Apply without a file reference).
- Mobile 390px: chat, code block, repository drawer, tabs + Monaco + dock all
  usable; desktop 1280px no horizontal overflow; console clean.
- `bunx tsc --noEmit` clean under src/; `bun run lint` 0 errors (1 benign
  pre-existing warning); `public/monaco/**` added to ESLint ignores (25 MB
  vendored asset — lint OOM without it).

## [Phase 5 — Advanced Repository Explorer] — VS Code-style file intelligence + V2.1 trust metadata

### Added
- **V2.1 §A — content classification**: `src/server/ingestion/classify.ts`
  tags indexed files as `repository_data` / `repository_documentation` /
  `repository_comment` / `repository_fixture` / `repository_generated_output`
  (informational, security-oriented — content is never treated as AI
  instructions; `null` = ordinary unclassified source). Persisted on
  `RepositoryFile.classification`; surfaced as an explainer badge in the
  editor header and intelligence panel.
- **V2.1 §B — index version metadata**: every `repository.index` run creates
  a `RepositoryIndexSnapshot` (ref, commitSha, kind, parser/chunking/embedding
  versions from `INDEX_METADATA_VERSIONS`, real `filesIndexed`,
  sha256 algorithm) with per-file `snapshotId` linkage, and computes REAL
  sha256 `contentHash` per indexed file (streamed, never fabricated). Prepares
  Phase 4.5 incremental processing.
- **V2.1 §C — symlink/archive safety**: refused entries are RECORDED, never
  executed — `DiscoveryResult.suspicious` + `ZipExtractResult.suspicious`
  persist as `RepositoryImportFinding` rows (symlink / unsafe_path /
  zip_rejected_entry), delete-before-insert idempotent per job.
- **V2.1 §D — import provenance**: every indexed file is traceable to
  repository (repositoryId) → snapshot (ref/commit) → source path → content
  hash.
- **Git working-tree status**: `src/lib/server/git-status.ts`
  (`git status --porcelain=v1 -z`, 3s timeout, never throws, honest 503) +
  `GET /api/repository/status`; tree rows, tabs and headers show real
  M/A/D/R/U indicators.
- **File provenance + history services**: `src/lib/server/file-provenance.ts`
  (mime/size/binary sniff, lastModified via `git log -1`, branch/sha via
  cached rev-parse, `--follow` history 1..20) + `GET /api/repository/file-history`.
- **File API variants**: `/api/repository/file?variant=full|meta|preview|download`
  (full stays byte-compatible + additive `meta`; meta works for binaries;
  image preview as data URL ≤2MB; raw download ≤10MB with attachment header).
- **Lazy directory loading**: `GET /api/repository/tree?path=<dir>` subtree
  route + client `loadDir` for server-`truncated` directories; per-dir 30s
  cache; file nodes carry `language`, capped dirs carry `truncated: true`.
- **Virtualized explorer** (`@tanstack/react-virtual`): only visible rows
  render (28px rows, overscan 12) — large trees never mount thousands of
  nodes; arrow-key row navigation; tree-reveal flash (breadcrumb-driven).
- **Fuzzy file search**: `repository/fuzzy.ts` subsequence scorer (boundary/
  consecutive/gap) powers the explorer filter and Code Search panel with
  `<mark>` highlights and scored ranking (top 100).
- **File-type icons**: `repository/file-icons.tsx` extension/name → lucide
  icon + color mapping across tree, tabs and lists.
- **Context menu** (real Radix ContextMenu): Open, Copy path, Copy relative
  path, Explain with AI (queues the file into the chat composer), Git
  history; references/symbols/review/tests/security/blame are explicitly
  disabled `[PLANNED]` — nothing simulated.
- **Three-region resizable editor** (`cmx-repo-h-v1`): tree | editor/output |
  file intelligence, all user-resizable; focus mode preserved; compact
  (<768px) stacked layout without horizontal panels.
- **Editor upgrades**: breadcrumbs (dir segments reveal in tree), metadata
  header (size, git badge, branch@shortSha, relative last-modified,
  classification), multi-line range highlight from navigation payloads,
  binary file view (metadata + safe image preview + download — never
  rendered as source).
- **Tab system upgrades**: git-status dots, middle-click close, per-tab menu
  (close/close others/close all), reopen-closed stack, 8-tab overflow menu,
  Alt+ArrowLeft/Right cycling, Alt+W close (Ctrl+W is browser-reserved —
  honest tooltip), LRU eviction pushes evicted tabs onto the reopen stack.
- **File Intelligence panel**: Overview (real provenance meta), Imports
  (REAL scan of loaded content; relative imports navigate), Tests (sibling
  heuristic), Git History (real `--follow` list, click copies SHA), Related
  Files (real siblings) + explicit `[PLANNED]` slots for AI summary,
  symbols, dependency graph, complexity, security, documentation.
- **Persistence v5** (`WORKSPACE_LAYOUT_VERSION 4→5`): adds persisted
  `intelligenceOpen`; older layouts reset per spec §31 while conversations/
  tabs/section survive; migrate bridge (Task 6) upgrades silently.

### Fixed
- Radix `ContextMenuTrigger asChild` on a memo component silently dropped
  the trigger's `onContextMenu`/ref (found via Playwright trusted-event
  right-click); the trigger now wraps a transparent div. Documented as a
  root-cause learning.
- `ClockRotateLeft` lucide icon does not exist in 0.525 → `History`.

### Verification
- tsc zero errors under `src/`; lint exit 0 (one benign React-Compiler
  incompatible-library note for react-virtual). Playwright (trusted events):
  context menu 5 real + 6 disabled-planned items, Explain-with-AI chip lands
  in the composer, tab close→reopen works, intelligence toggles, breadcrumbs
  present, zero horizontal overflow at 1280 and 390, zero page errors;
  live API probes for tree/status/file-variants/history all green; db:push
  purely additive (row counts verified before/after; 33 tables).

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
