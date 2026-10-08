"use client";

/**
 * CodeMind X V2 — real-time activity chain (Phase 8D, spec STEP B).
 *
 * The production replacement for the old assistant thought UI:
 *
 *   [3×3 lattice] Thinking >        (active, thinking-only work)
 *   [22px orb] Solving >            (after the first real mutating/executing
 *                                    activity — never reverts)
 *   Waiting for approval >          (timer paused)
 *   Waiting for your answer >       (timer paused)
 *   Thought for 24s >               (completed, thinking-only)
 *   Worked for 1m 12s >             (completed after solving)
 *   Failed after 18s >              (failed — history preserved)
 *   Stopped after 12s >             (cancelled — history preserved)
 *
 * Behaviour: clickable header (aria-expanded/aria-controls), grid-rows
 * 0fr→1fr expansion (~300ms ease-out), collapsed content is INERT, one
 * polite live region for state changes, auto-collapse on completion unless
 * the user explicitly toggled (hasUserControlledOpenState), ~40vh running
 * cap with newest-follow scrolling, 200-row render cap with an "Earlier
 * steps" expander, per-row entrance animation, memoized rows, dots per
 * status (accent pulse / secondary / error / muted / attention), real file
 * rows navigate through the shared EditorNavigationService, and search
 * results show only real returned files. Labels come ONLY from fixed
 * templates; model free text and private reasoning can never appear here.
 *
 * Rendering paths:
 * - <ActivityChainLive runId> — the active run (per-run external store).
 * - <ActivityChain chain={persisted}> — history (reload keeps the chain).
 * - <ActivityChain legacySteps={...}> — pre-8D history rendered through the
 *   new presentation (read-only migration of the old ThoughtChain data).
 */

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

import type {
  ActivityRowStatus,
  ActivityViewRow,
  ActivityViewChild,
  PersistedActivityChain,
  RunActivitySnapshot,
} from "@/types/contracts";
import { editorNavigation } from "@/features/workspace/editor-navigation";
import type { ChatActivityStep } from "@/features/workspace/types";
import type {
  ApprovalDecision,
  ApprovalRequest,
} from "@/features/workspace/assistant/contracts";
import { ApprovalCard } from "@/components/ai/ApprovalCard";
import { formatActiveDuration } from "@/features/workspace/chat/activity/duration";
import { snapshotFromPersistedChain } from "@/features/workspace/chat/activity/run-activity-store";
import { releaseChainCloseGate, logChainGate } from "@/features/workspace/chat/activity/chain-close-gate";
import { useRunActivity } from "@/features/workspace/chat/activity/use-run-activity";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { SolvingIndicator, WaitingIndicator } from "./SolvingIndicator";

import "./activity.css";

/* ------------------------------------------------------------------ */
/* Duration + aria helpers                                             */
/* ------------------------------------------------------------------ */

/** "8s" → "8 seconds"; "1m 12s" → "1 minute 12 seconds"; "<1s" → honest. */
function ariaDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "less than 1 second";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 1) return "less than 1 second";
  if (totalSeconds < 60) {
    const seconds = Math.round(totalSeconds);
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  const minutePart = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (seconds === 0) return minutePart;
  return `${minutePart} ${seconds} second${seconds === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */
/* Header state model                                                  */
/* ------------------------------------------------------------------ */

type HeaderKind = "thinking" | "solving" | "waiting" | "final";

/**
 * Live-region text — derived, never stored: the string only changes when
 * the run's meaningful state changes, so the polite region announces
 * exactly the state transitions (Thinking / Solving / Waiting… /
 * Worked for N seconds / Stopped / Failed) and nothing else.
 */
function deriveAnnouncement(snapshot: RunActivitySnapshot): string {
  if (snapshot.status === "final") {
    if (snapshot.finalState === "failed") return "Failed";
    if (snapshot.finalState === "cancelled") return "Stopped";
    return `${snapshot.reachedSolving ? "Worked for" : "Thought for"} ${ariaDuration(snapshot.activeMs)}`;
  }
  if (snapshot.status === "waiting") {
    return snapshot.waitingKind === "approval"
      ? "Waiting for approval"
      : "Waiting for your answer";
  }
  if (snapshot.status === "running" && !snapshot.workFinalized) {
    return snapshot.phase === "solving" ? "Solving" : "Thinking";
  }
  return "";
}

interface HeaderState {
  kind: HeaderKind;
  label: string;
  aria: string;
  outcome: "completed" | "failed" | "cancelled" | null;
}

function headerState(snapshot: RunActivitySnapshot): HeaderState {
  const finalized = snapshot.status === "final" || snapshot.workFinalized;
  if (finalized) {
    const duration = formatActiveDuration(snapshot.activeMs);
    const durationAria = ariaDuration(snapshot.activeMs);
    if (snapshot.finalState === "failed") {
      return {
        kind: "final",
        label: `Failed after ${duration}`,
        aria: `Failed after ${durationAria}, show details`,
        outcome: "failed",
      };
    }
    if (snapshot.finalState === "cancelled") {
      return {
        kind: "final",
        label: `Stopped after ${duration}`,
        aria: `Stopped after ${durationAria}, show details`,
        outcome: "cancelled",
      };
    }
    if (snapshot.reachedSolving) {
      return {
        kind: "final",
        label: `Worked for ${duration}`,
        aria: `Worked for ${durationAria}, show details`,
        outcome: "completed",
      };
    }
    return {
      kind: "final",
      label: `Thought for ${duration}`,
      aria: `Thought for ${durationAria}, show details`,
      outcome: "completed",
    };
  }

  if (snapshot.status === "waiting") {
    const label =
      snapshot.waitingKind === "approval"
        ? "Waiting for approval"
        : "Waiting for your answer";
    return { kind: "waiting", label, aria: label, outcome: null };
  }

  if (snapshot.phase === "solving") {
    return { kind: "solving", label: "Solving", aria: "Solving", outcome: null };
  }
  return {
    kind: "thinking",
    label: "Thinking",
    aria: "Thinking, in progress",
    outcome: null,
  };
}

/* ------------------------------------------------------------------ */
/* Rows (memoized — one row re-renders only when its data changes)      */
/* ------------------------------------------------------------------ */

const ChildRow = memo(function ChildRow({ child }: { child: ActivityViewChild }) {
  const lineMeta =
    child.line !== null && child.line !== undefined ? (
      <span className="cmx-act-child-meta">L{child.line}</span>
    ) : null;

  if (child.path) {
    return (
      <button
        type="button"
        className="cmx-act-child"
        title={child.path}
        onClick={() => {
          void editorNavigation.openFile(child.path as string);
        }}
      >
        <span className="cmx-act-child-path">{child.label}</span>
        {lineMeta}
      </button>
    );
  }
  return (
    <span className="cmx-act-child">
      <span>{child.label}</span>
      {lineMeta}
    </span>
  );
});

/**
 * Inline side chip — the real content beside the row's title:
 * the repository-search query beside "Searching repository", the target
 * path beside a single "Reading/Editing/Creating/Removing/Renaming" row,
 * or the served model beside "Preparing response" (the gateway serves
 * glm-4-plus — user direction: the model name carries the dark grey chip
 * on the Preparing response row). Group rows keep the count in their
 * title and list every file in the dropdown body.
 */
function sideChipFor(row: ActivityViewRow): string | null {
  if (row.kind === "repo_search") {
    return row.query ?? null;
  }
  if (row.kind === "prepare") {
    // Fixed, honest label — the gateway's served model (llm-gateway.ts).
    return "glm-4-plus";
  }
  if (
    (row.kind === "read_file" ||
      row.kind === "edit_file" ||
      row.kind === "create_file" ||
      row.kind === "delete_file" ||
      row.kind === "rename_file") &&
    row.groupCount === null
  ) {
    return row.children.find((child) => child.path)?.path ?? null;
  }
  return null;
}

/**
 * One timeline row: [dot] [title] [inline content chip] ......... [▸]
 * with a collapsible body (detail line + file children). The chevron sits
 * on the RIGHT of the line (same affordance as the header chevron) and
 * hides/shows the child rows. Plain file rows already carry their path on
 * the line — a single-file dropdown would be redundant, so only GROUP rows
 * ("Read 4 files" / "Edited 5 files") and detail-bearing rows expand.
 * Open by default EXCEPT counter groups ("Read N files", Phase 9.1) which
 * mount collapsed — the live count is the point, not the file list.
 */
const ActivityItem = memo(function ActivityItem({
  row,
  showLoader = false,
}: {
  row: ActivityViewRow;
  /** User mandate (RULES.md §15): while the chain is closing, the LAST row
   * carries a loader for 1.5s — the close fires only after it ends. */
  showLoader?: boolean;
}) {
  const side = sideChipFor(row);
  // Plain single-file rows: the path is already ON the line — the one-file
  // dropdown would be pure duplication. Only rows whose children carry
  // EXTRA information (mixed children, non-file children) keep a body.
  const singleFileChild =
    row.children.length <= 1 && row.children.every((child) => child.path !== null);
  const isPlainFileRow = row.groupCount === null && side !== null && singleFileChild;
  const detailInBody = row.detail !== null && row.detail !== side;
  const hasBody = isPlainFileRow ? detailInBody : row.children.length > 0 || detailInBody;
  // User direction (Phase 9.1): the first THREE file reads show one by one;
  // the moment they merge into a counter group ("Read 4 files"), the
  // dropdown closes instantly — the group row mounts COLLAPSED and the
  // live count is read straight off the title. The user can still open
  // any group by clicking; their toggle wins while mounted.
  const [open, setOpen] = useState(row.groupCount === null);
  const bodyId = `${row.id}-body`;

  const line = (
    <>
      {/* Titles are PLAIN text (user direction — the "Preparing response"
          dark grey panel was removed in 9.1); the dark grey rounded chips
          are reserved for the row's CONTENT: the query, file paths, and
          the served model ("glm-4-plus") beside Preparing response. */}
      <span className="cmx-act-title-chip">{row.title}</span>
      {side !== null ? (
        <span className="cmx-act-side-chip" title={side}>
          {side}
        </span>
      ) : null}
      {showLoader ? (
        <span
          className="cmx-act-row-loader"
          aria-hidden="true"
          data-testid="chain-close-loader"
        />
      ) : null}
    </>
  );

  return (
    <div className="cmx-act-item" data-status={row.status}>
      <span aria-hidden="true" className="cmx-act-dot" data-status={row.status} />
      <div className="cmx-act-item-main">
        {hasBody ? (
          <button
            type="button"
            className="cmx-act-row-line"
            aria-expanded={open}
            aria-controls={bodyId}
            data-testid="activity-row-toggle"
            onClick={() => setOpen((current) => !current)}
          >
            {line}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="cmx-act-row-chevron"
              data-open={open ? "true" : "false"}
            >
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        ) : (
          <div className="cmx-act-row-line">{line}</div>
        )}
        {hasBody ? (
          <div
            className="cmx-act-row-clip"
            data-open={open ? "true" : "false"}
            id={bodyId}
            inert={open ? undefined : true}
          >
            <div className="cmx-act-row-clip-inner">
              {detailInBody ? <div className="cmx-act-item-detail">{row.detail}</div> : null}
              {!isPlainFileRow && row.children.length > 0 ? (
                <ul className="cmx-act-child-list">
                  {row.children.map((child) => (
                    <li key={child.id}>
                      <ChildRow child={child} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Timeline view (shared by live + static)                             */
/* ------------------------------------------------------------------ */

const RENDER_ROW_CAP = 200;

export interface ActivityChainViewProps {
  snapshot: RunActivitySnapshot;
  /** Casual prompts ("hii", "hello", "how are you", "what's your name"):
   * the chain stays COLLAPSED — only the Thinking/Thought chip shows. The
   * steps are still recorded + paced one by one BEHIND the dropdown; the
   * user opens it when THEY want to look. Non-casual (task) runs keep the
   * visible one-by-one story. */
  minimal?: boolean;
  /* ---- Agent Mode V2 (spec §3/§51): approval INSIDE the chain ----
   * The approval card renders as the body of the chain's waiting_approval
   * row — never as a normal chat message. The decision callback releases
   * the real engine gate through /api/assistant/approvals. */
  approval?: ApprovalRequest | null;
  approvalDecision?: ApprovalDecision | null;
  onApprovalDecision?: (decision: "approved" | "rejected") => void;
}

export function ActivityChainView({
  snapshot,
  minimal = false,
  approval,
  approvalDecision,
  onApprovalDecision,
}: ActivityChainViewProps) {
  const controlsId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  /* Collapse: open while active, auto-collapse on finalize/completion —
     unless the user explicitly toggled (their choice wins). Derived from
     the snapshot — no state-sync effect needed:
     userOpen === null → follow the run state; otherwise the user decides. */
  const active = snapshot.status !== "final" && !snapshot.workFinalized;
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  /* ─────────────────────────────────────────────────────────────────
   * USER MANDATE (stored RULES.md §15) — "Thought chain close": the
   * chain closes ONLY after its last row completes; the last row then
   * shows a LOADER for exactly 1.5s; when the loader ends the chain
   * closes FULLY and INSTANTLY in one shot — never the gradual 300ms
   * collapse, never a half-closed state. The header keeps its live
   * indicator (Thinking/Solving) until the close fires, so the final
   * duration label lands exactly at the close moment. Views that are
   * ALREADY final at mount (history) skip the loader — the mandate
   * governs the live transition, not history rendering.
   * ───────────────────────────────────────────────────────────────── */
  const CHAIN_CLOSE_LOADER_MS = 1500;
  /** Last row completed → loader phase (timeline still open). */
  const [closingLoader, setClosingLoader] = useState(false);
  /** Loader ended → FULL one-shot close (CSS transition disabled). */
  const [fullClose, setFullClose] = useState(false);
  /* Transition detection — the sanctioned render-phase adjustment pattern
   * ("You might not need an effect"): the previous `active` value lives in
   * state, and flipping it here schedules the close machine's state changes
   * during render. A mount that is ALREADY final (history) initializes
   * prevActive to false → no transition → no loader, exactly as mandated.
   * (The previous effect-based version tripped the react-hooks
   * "setState synchronously within an effect" rule after a lint toolchain
   * update; behavior is identical — same transitions, same 1.5s timer.) */
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (active) {
      // A new active phase — reset the close machine.
      setClosingLoader(false);
      setFullClose(false);
    } else {
      // LIVE active→final transition — the mandated loader phase begins.
      setClosingLoader(true);
    }
  }
  /* The loader's 1.5s timer is the effect's external-system work; the state
   * changes inside its callback are async (allowed). It arms only after the
   * render-phase adjustment above set closingLoader, and the cleanup keeps
   * the close tied to this exact loader phase. */
  useEffect(() => {
    if (!closingLoader) return;
    logChainGate("loader-start");
    const timer = setTimeout(() => {
      setClosingLoader(false);
      setFullClose(true); // FULL close — one shot, no animation
      logChainGate("full-close");
      /* USER MANDATE (RULES.md §15 "Thought Chain Working Phase"): the AI
       * response starts ONLY now — after the loader ended and the chain has
       * fully closed. Release the gate use-assistant-run holds the buffered
       * answer on. No-op when nothing is armed (history/error paths). */
      releaseChainCloseGate();
    }, CHAIN_CLOSE_LOADER_MS);
    return () => {
      clearTimeout(timer);
      logChainGate("loader-cleanup");
    };
  }, [closingLoader]);

  // Minimal runs never auto-open: the user's click is the ONLY opener.
  // The loader phase keeps the timeline open until the full close fires.
  const open = userOpen ?? (minimal ? false : active || closingLoader);

  const toggle = (): void => {
    setUserOpen(!open);
  };

  /* Newest-follow inside the ~40vh running cap (no chat-level jumps). */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [snapshot.rows, open]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  /* One polite live region for meaningful state changes only — derived
     text: identical strings never touch the DOM, so nothing is
     re-announced while events merely add rows. During the mandated
     close-loader the chain has not closed yet — the header state and
     announcement stay on the live indicator; the final label lands
     exactly at the close moment (after the 1.5s loader). */
  const rawState = headerState(snapshot);
  const state: HeaderState =
    closingLoader && rawState.kind === "final"
      ? {
          kind: snapshot.phase === "solving" ? "solving" : "thinking",
          label: snapshot.phase === "solving" ? "Solving" : "Thinking",
          aria: snapshot.phase === "solving" ? "Solving" : "Thinking",
          outcome: null,
        }
      : rawState;
  const announcement = closingLoader
    ? snapshot.phase === "solving"
      ? "Solving"
      : "Thinking"
    : deriveAnnouncement(snapshot);

  /* Cross-fade: the previous header state stays mounted (hidden via
     aria-hidden + CSS) until the next change — render-phase adjustment,
     the sanctioned React pattern for tracking prior prop/state values. */
  const [fade, setFade] = useState<{ current: HeaderKind; previous: HeaderKind | null }>({
    current: state.kind,
    previous: null,
  });
  if (fade.current !== state.kind) {
    setFade({ current: state.kind, previous: fade.current });
  }

  const hiddenCount = snapshot.hiddenEarlierCount;
  const canExpandEarlier = snapshot.rows.length > RENDER_ROW_CAP;
  const visibleRows =
    canExpandEarlier && !showEarlier
      ? snapshot.rows.slice(snapshot.rows.length - RENDER_ROW_CAP)
      : snapshot.rows;

  const layer = (kind: HeaderKind): React.ReactNode => {
    switch (kind) {
      case "thinking":
        return <ThinkingIndicator />;
      case "solving":
        return <SolvingIndicator />;
      case "waiting":
        return <WaitingIndicator label={state.label} />;
      case "final":
        return (
          <span className="cmx-act-final-label" data-outcome={state.outcome ?? "completed"}>
            {state.label}
          </span>
        );
    }
  };

  return (
    <div className="cmx-act" data-testid="activity-chain" data-active={active ? "true" : "false"}>
      <button
        type="button"
        className="cmx-act-header"
        aria-expanded={open}
        aria-controls={controlsId}
        aria-label={state.aria}
        data-testid="activity-chain-header"
        onClick={toggle}
      >
        <span className="cmx-act-indicator-shell">
          <span className="cmx-act-indicator-layer" aria-hidden={false}>
            {layer(fade.current)}
          </span>
          {fade.previous !== null && fade.previous !== fade.current ? (
            <span className="cmx-act-indicator-layer" aria-hidden="true">
              {layer(fade.previous)}
            </span>
          ) : null}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cmx-act-chevron"
          data-open={open ? "true" : "false"}
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
      </button>

      <div
        className="cmx-act-timeline-grid"
        data-open={open ? "true" : "false"}
        data-full-close={fullClose ? "true" : "false"}
      >
        <div className="cmx-act-timeline-clip">
          <div
            id={controlsId}
            ref={scrollRef}
            onScroll={onScroll}
            className="cmx-act-timeline-scroll"
            inert={open ? undefined : true}
          >
            <div className="cmx-act-timeline">
              {hiddenCount > 0 ? (
                canExpandEarlier ? (
                  <button
                    type="button"
                    className="cmx-act-earlier"
                    onClick={() => setShowEarlier(true)}
                  >
                    Earlier steps ({hiddenCount})
                  </button>
                ) : (
                  <div className="cmx-act-earlier">Earlier steps ({hiddenCount})</div>
                )
              ) : null}
              {visibleRows.map((row, index) => (
                <div key={row.id} className="cmx-act-row-wrap">
                  <ActivityItem
                    row={row}
                    showLoader={closingLoader && index === visibleRows.length - 1}
                  />
                  {/* Agent Mode V2 (spec §3/§51): the approval card lives
                      INSIDE the thought chain, right under its waiting row
                      — a blocking decision surface, not a chat message. */}
                  {row.kind === "waiting_approval" && approval ? (
                    <div className="cmx-act-approval-slot">
                      <ApprovalCard
                        approval={approval}
                        decision={approvalDecision ?? null}
                        onDecision={(decision) => {
                          if (decision === "edited") {
                            // "Edit" opens the affected files for manual
                            // review; it never releases the engine gate.
                            const first = approval.affectedFiles[0];
                            if (first) void editorNavigation.openFile(first, "manual");
                            return;
                          }
                          onApprovalDecision?.(decision);
                        }}
                        disabled={approvalDecision !== null && approvalDecision !== undefined}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <span className="cmx-act-live-region" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live binding (per-run store)                                        */
/* ------------------------------------------------------------------ */

export function ActivityChainLive({
  runId,
  minimal = false,
  approval,
  approvalDecision,
  onApprovalDecision,
}: {
  runId: string | null;
  minimal?: boolean;
  approval?: ApprovalRequest | null;
  approvalDecision?: ApprovalDecision | null;
  onApprovalDecision?: (decision: "approved" | "rejected") => void;
}) {
  const snapshot = useRunActivity(runId);
  // Before the run's first real event the chain shows nothing — nothing is
  // fabricated; RUN_STARTED arrives within milliseconds of send().
  if (!runId) return null;
  if (snapshot.status === "idle" && snapshot.runId === "") {
    return (
      <div className="cmx-act" data-testid="activity-chain">
        <ThinkingIndicator />
      </div>
    );
  }
  return (
    <ActivityChainView
      snapshot={snapshot}
      minimal={minimal}
      approval={approval}
      approvalDecision={approvalDecision}
      onApprovalDecision={onApprovalDecision}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Static bindings (history)                                           */
/* ------------------------------------------------------------------ */

/** Pre-8D legacy activity steps → new chain snapshot (history migration). */
const LEGACY_KIND: Record<string, ActivityViewRow["kind"]> = {
  understanding: "understand",
  search: "repo_search",
  read: "read_file",
  plan: "plan",
  code: "edit_file",
  test: "run_tests",
  security: "verify",
  git: "tool",
  architecture: "analysis",
  finalize: "verify",
  deployment: "run_command",
};

const LEGACY_STATUS: Record<string, ActivityRowStatus> = {
  pending: "completed",
  active: "completed",
  done: "completed",
  error: "failed",
};

export function snapshotFromLegacySteps(
  steps: ChatActivityStep[],
  thoughtForMs: number | null,
  runId: string | null,
): RunActivitySnapshot | null {
  if (steps.length === 0) return null;
  const rows: ActivityViewRow[] = steps.map((step, index) => {
    const children: ActivityViewChild[] = (step.children ?? []).map((child, childIndex) => {
      const match = /^read_file\s+(.+)$/.exec(child.label);
      const path = match ? match[1] : null;
      return {
        id: `${step.id}-c-${childIndex}`,
        label: child.label,
        path,
        line: null,
      };
    });
    return {
      id: step.id || `legacy-${index}`,
      kind: LEGACY_KIND[step.kind] ?? "tool",
      // Legacy labels are the old phase's fixed system templates — safe.
      title: step.label,
      detail: step.detail ?? null,
      status: LEGACY_STATUS[step.status] ?? "completed",
      seq: index + 1,
      children,
      groupCount: null,
    };
  });
  const anyFailed = steps.some((step) => step.status === "error");
  return {
    runId: runId ?? "legacy",
    status: "final",
    phase: "thinking",
    waitingKind: null,
    questionBatch: null,
    rows,
    hiddenEarlierCount: Math.max(0, rows.length - RENDER_ROW_CAP),
    workFinalized: true,
    reachedSolving: false,
    activeMs: thoughtForMs ?? 0,
    finalState: anyFailed ? "failed" : "completed",
    startedAt: null,
    endedAt: null,
  };
}

export interface ActivityChainProps {
  /** Persisted 8D chain (preferred). */
  chain?: PersistedActivityChain | null;
  /** Pre-8D history fallback (old ThoughtChain data). */
  legacySteps?: ChatActivityStep[];
  legacyThoughtForMs?: number | null;
  legacyRunId?: string | null;
  /* ---- Agent Mode V2: approval inside the chain (history + waiting) ---- */
  approval?: ApprovalRequest | null;
  approvalDecision?: ApprovalDecision | null;
  onApprovalDecision?: (decision: "approved" | "rejected") => void;
}

export function ActivityChain({
  chain,
  legacySteps,
  legacyThoughtForMs,
  legacyRunId,
  approval,
  approvalDecision,
  onApprovalDecision,
}: ActivityChainProps) {
  const snapshot = useMemo(() => {
    if (chain) return snapshotFromPersistedChain(chain);
    if (legacySteps && legacySteps.length > 0) {
      return snapshotFromLegacySteps(legacySteps, legacyThoughtForMs ?? null, legacyRunId ?? null);
    }
    return null;
  }, [chain, legacySteps, legacyThoughtForMs, legacyRunId]);

  if (!snapshot) return null;
  return (
    <ActivityChainView
      snapshot={snapshot}
      approval={approval}
      approvalDecision={approvalDecision}
      onApprovalDecision={onApprovalDecision}
    />
  );
}
