"use client";

/**
 * CodeMind X V2 — per-run activity store (Phase 8D, spec STEP A + STEP C).
 *
 * The adapter/view layer on top of the EXISTING Phase-8 sequenced events:
 * it does NOT replace the wire contracts or the AssistantActivityEngine —
 * it maps the same real events into a deterministic visual activity chain
 * consumed via useSyncExternalStore through useRunActivity(runId).
 *
 * Guarantees (spec A.1–A.9, §62):
 * - idempotent ingestion: duplicate seq events are ignored; replayed
 *   (reconnect) deliveries never duplicate timeline rows;
 * - stale events never overwrite newer row state (per-row seq guard);
 * - malformed events are dropped at the boundary;
 * - phase machine: default thinking; a file read/create/edit/delete/rename
 *   row RUNNING IN FLIGHT → solving, and back to thinking the moment no
 *   file row is running anymore (user direction: Solving text + orb show
 *   exactly while file work is happening, never otherwise); waiting pauses
 *   the ACTIVE-WORK timer; the first final-answer chunk closes the work
 *   phase; the first terminal event
 *   finalizes the run;
 * - ONE run-level active-work timer per run (performance.now() + explicit
 *   paused accumulator; server timestamps kept for history);
 * - one rAF-batched flush per frame — a new event in one run never
 *   re-renders any other run's subscribers;
 * - render cap: max 200 rendered rows; 4+ consecutive same-kind operations
 *   merge into grouped rows ("Read 12 files"); older rows sit behind the
 *   "Earlier steps" expander.
 *
 * Immutability discipline: rows are copy-on-write — the reducer NEVER
 * mutates a row (or the rows array) that is already part of a flushed
 * snapshot, so cached snapshots stay stable and memoized rows keep identity.
 *
 * Privacy: titles come from fixed templates / fixed server-side stage
 * titles; details are redacted (redact.ts) BEFORE any render; model free
 * text never enters the chain and no "reasoning" kind exists.
 */

import type {
  ActivityViewKind,
  ActivityViewRow,
  ActivityViewChild,
  ActivityWaitingKind,
  PersistedActivityChain,
  RunActivitySnapshot,
} from "@/types/contracts";
import type {
  ActivityNode,
  IntakeQuestionBatch,
  SequencedAssistantEvent,
} from "../../assistant/contracts";
import {
  createActiveTimer,
  finalizeTimer,
  pauseTimer,
  readTimer,
  resumeTimer,
  type ActiveTimer,
} from "./duration";
import {
  groupTitleFor,
  isGroupable,
  mapViewKind,
  middleEllipsis,
  titleForKind,
  triggersSolving,
} from "./titles";
import { redactDetail } from "./redact";

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/** Maximum RENDERED timeline rows (spec "LONG-RUN / LOOP POLICY"). */
export const ACTIVITY_ROW_CAP = 200;
/** Maximum rows persisted with the message (localStorage-friendly). */
const PERSISTED_ROW_CAP = 200;
/** Consecutive same-kind rows before merging into a group (spec: 4+). */
const GROUP_THRESHOLD = 4;
/** Max file children rendered under one row (group dropdown) before "+N more". */
const CHILDREN_CAP = 12;

/* ------------------------------------------------------------------ */
/* Internal state                                                      */
/* ------------------------------------------------------------------ */

interface RunActivityState {
  runId: string;
  status: "idle" | "running" | "waiting" | "final";
  phase: "thinking" | "solving";
  waitingKind: ActivityWaitingKind | null;
  questionBatch: IntakeQuestionBatch | null;
  rows: ActivityViewRow[];
  workFinalized: boolean;
  reachedSolving: boolean;
  activeMs: number;
  finalState: "completed" | "failed" | "cancelled" | null;
  startedAt: number | null;
  endedAt: number | null;
  /* internals (never exposed in snapshots) */
  timer: ActiveTimer;
  processedSeqs: Set<number>;
  maxSeq: number;
  dirty: boolean;
  malformed: number;
}

const EMPTY_SNAPSHOT: RunActivitySnapshot = {
  runId: "",
  status: "idle",
  phase: "thinking",
  waitingKind: null,
  questionBatch: null,
  rows: [],
  hiddenEarlierCount: 0,
  workFinalized: false,
  reachedSolving: false,
  activeMs: 0,
  finalState: null,
  startedAt: null,
  endedAt: null,
};

const runs = new Map<string, RunActivityState>();
const snapshotCache = new Map<string, RunActivitySnapshot>();
const listeners = new Map<string, Set<() => void>>();

let flushScheduled = false;

/* ------------------------------------------------------------------ */
/* Registration + subscription                                         */
/* ------------------------------------------------------------------ */

function ensureRun(runId: string): RunActivityState {
  let state = runs.get(runId);
  if (!state) {
    state = {
      runId,
      status: "idle",
      phase: "thinking",
      waitingKind: null,
      questionBatch: null,
      rows: [],
      workFinalized: false,
      reachedSolving: false,
      activeMs: 0,
      finalState: null,
      startedAt: null,
      endedAt: null,
      timer: createActiveTimer(performance.now()),
      processedSeqs: new Set(),
      maxSeq: 0,
      dirty: false,
      malformed: 0,
    };
    runs.set(runId, state);
  }
  return state;
}

/** Subscribe one component to one run's activity (per-run isolation). */
export function subscribeRunActivity(
  runId: string,
  listener: () => void,
): () => void {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(runId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(runId);
      // GC finished runs once nothing observes them (the message carries
      // the persisted chain afterwards).
      const state = runs.get(runId);
      if (state && state.status === "final") {
        runs.delete(runId);
        snapshotCache.delete(runId);
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Flush scheduling — ONE rAF batch per frame                          */
/* ------------------------------------------------------------------ */

function scheduleFlush(): void {
  if (flushScheduled || typeof window === "undefined") return;
  flushScheduled = true;
  const run = (): void => {
    flushScheduled = false;
    flush();
  };
  // rAF batches visually; a short timeout fallback guarantees the flush
  // even when the tab is hidden (rAF does not fire there).
  if (typeof document !== "undefined" && document.hidden) {
    window.setTimeout(run, 16);
  } else {
    window.requestAnimationFrame(run);
    window.setTimeout(() => {
      if (flushScheduled) {
        flushScheduled = false;
        flush();
      }
    }, 32);
  }
}

function flush(): void {
  for (const [runId, state] of runs) {
    if (!state.dirty) continue;
    state.dirty = false;
    snapshotCache.set(runId, buildSnapshot(state));
    const subs = listeners.get(runId);
    if (subs) {
      for (const listener of subs) listener();
    }
  }
}

function buildSnapshot(state: RunActivityState): RunActivitySnapshot {
  // Rows are copy-on-write: the snapshot can safely share the live array,
  // because the reducer replaces (never mutates) rows already published.
  return {
    runId: state.runId,
    status: state.status,
    phase: state.phase,
    waitingKind: state.waitingKind,
    questionBatch: state.questionBatch,
    rows: state.rows,
    hiddenEarlierCount: Math.max(0, state.rows.length - ACTIVITY_ROW_CAP),
    workFinalized: state.workFinalized,
    reachedSolving: state.reachedSolving,
    activeMs: state.activeMs,
    finalState: state.finalState,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
  };
}

/** Stable snapshot accessor for useSyncExternalStore (cached per run). */
export function getRunActivitySnapshot(runId: string): RunActivitySnapshot {
  return snapshotCache.get(runId) ?? EMPTY_SNAPSHOT;
}

/** Server snapshot — one stable shared object (SSR-safe, no per-run state). */
export function getServerRunActivitySnapshot(): RunActivitySnapshot {
  return EMPTY_SNAPSHOT;
}

/* ------------------------------------------------------------------ */
/* Pure row helpers (copy-on-write)                                    */
/* ------------------------------------------------------------------ */

function safeTitle(
  backendTitle: string | undefined,
  kind: ActivityViewKind,
): string {
  // Titles ALWAYS come from the adapter's fixed template for the mapped
  // kind (spec "FIXED ACTIVITY TITLES") — the backend's own stage title is
  // only used to pick the kind. No free text can reach the title slot.
  void backendTitle;
  return titleForKind(kind);
}

function makeChild(
  path: string,
  line: number | null,
  labelPrefix: string,
): ActivityViewChild {
  const display = middleEllipsis(path, 48);
  return {
    id: `${labelPrefix}:${path}:${line ?? 0}`,
    label: `${labelPrefix} ${display}`.trim(),
    path,
    line,
  };
}

/**
 * Merge children lists for GROUP rows (copy-on-write): every merged op's
 * files stay listed under the group row ("Edited 5 files" → the dropdown
 * lists all five), deduped by id, recomputing the "+N more" overflow marker.
 */
function mergeChildren(
  rowId: string,
  base: ActivityViewChild[],
  extra: ActivityViewChild[],
): ActivityViewChild[] {
  const moreId = `${rowId}-more`;
  const merged = base.filter((c) => c.id !== moreId);
  for (const child of extra) {
    if (merged.some((c) => c.id === child.id)) continue;
    merged.push(child);
  }
  if (merged.length <= CHILDREN_CAP) return merged;
  const overflow = merged.length - CHILDREN_CAP;
  return [
    ...merged.slice(0, CHILDREN_CAP),
    { id: moreId, label: `+${overflow} more`, path: null, line: null },
  ];
}

function updateRowById(
  state: RunActivityState,
  rowId: string,
  update: (row: ActivityViewRow) => ActivityViewRow,
): void {
  let changed = false;
  state.rows = state.rows.map((row) => {
    if (row.id !== rowId) return row;
    changed = true;
    return update(row);
  });
  if (changed) state.dirty = true;
}

/**
 * Append a row with the long-run grouping policy: when GROUP_THRESHOLD
 * consecutive same-kind (groupable) operations accumulate, they merge into
 * ONE grouped row ("Read 12 files") that keeps the latest item visible.
 */
function appendRow(state: RunActivityState, row: ActivityViewRow): void {
  const rows = state.rows;

  if (isGroupable(row.kind)) {
    const last = rows[rows.length - 1];
    // Already a group of the same kind → absorb (copy-on-write). The
    // merged row KEEPS every absorbed op's file children (dropdown lists
    // all of them) and its query chip when both carry one.
    if (last && last.groupCount !== null && last.kind === row.kind) {
      const nextCount = last.groupCount + 1;
      updateRowById(state, last.id, (current) => ({
        ...current,
        groupCount: nextCount,
        title: groupTitleFor(current.kind, nextCount),
        status: row.status,
        seq: Math.max(current.seq, row.seq),
        detail: row.detail ?? current.detail,
        query: row.query ?? current.query ?? null,
        children: mergeChildren(last.id, current.children, row.children),
      }));
      state.dirty = true;
      return;
    }

    // Count consecutive same-kind plain rows at the tail.
    let tailCount = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const candidate = rows[i];
      if (candidate.groupCount === null && candidate.kind === row.kind) {
        tailCount += 1;
      } else {
        break;
      }
    }

    if (tailCount >= GROUP_THRESHOLD - 1) {
      // Convert the tail + the incoming row into ONE group row that keeps
      // every converted op's file children (dropdown lists all of them).
      const tailRows = rows.slice(rows.length - tailCount);
      const group: ActivityViewRow = {
        id: `group-${row.kind}-${row.id}`,
        kind: row.kind,
        title: groupTitleFor(row.kind, tailCount + 1),
        detail: tailRows.map((r) => r.detail).find(Boolean) ?? row.detail,
        status: row.status,
        seq: row.seq,
        children: tailRows.reduce(
          (acc, r) => mergeChildren(`group-${row.kind}-${row.id}`, acc, r.children),
          row.children,
        ),
        groupCount: tailCount + 1,
        query: row.query ?? null,
      };
      state.rows = [...rows.slice(0, rows.length - tailCount), group];
      state.dirty = true;
      return;
    }
  }

  // Prototype behavior: a newly appearing row completes the previous one —
  // the tail row's formal COMPLETED event may still be in flight, but the
  // work it describes has visibly ended (its summary/detail still lands when
  // the event arrives). Only the LAST running row settles; waiting rows stay.
  if (rows.length > 0) {
    const tailIndex = rows.length - 1;
    const tail = rows[tailIndex];
    if (tail && tail.status === "running") {
      state.rows = [...rows.slice(0, tailIndex), { ...tail, status: "completed" }];
    }
  }

  state.rows = [...state.rows, row];
  state.dirty = true;
}

/** Complete (or fail/cancel) any row still marked running/waiting. */
function settleRunningRows(
  state: RunActivityState,
  status: ActivityViewRow["status"],
): void {
  state.rows = state.rows.map((row) =>
    row.status === "running" || row.status === "waiting" ? { ...row, status } : row,
  );
}

/* ------------------------------------------------------------------ */
/* Reducer — one real wire event → chain state                         */
/* ------------------------------------------------------------------ */

/**
 * THE phase rule (single source of truth, recomputed after every event):
 * the header shows Solving exactly while a file read/create/edit/delete/
 * rename row is visibly running — the moment the last file row settles
 * (and no other file row is in flight), the header reverts to Thinking.
 * reachedSolving is the LATCH for the final label only ("Worked for" vs
 * "Thought for") — it never drives the live header.
 */
function syncPhase(state: RunActivityState): void {
  if (state.workFinalized || state.status !== "running") return;
  state.phase = state.rows.some(
    (row) => row.status === "running" && triggersSolving(row.kind),
  )
    ? "solving"
    : "thinking";
}

function applyEvent(state: RunActivityState, event: SequencedAssistantEvent): void {
  applyEventReducer(state, event);
  syncPhase(state);
}

function applyEventReducer(
  state: RunActivityState,
  event: SequencedAssistantEvent,
): void {
  const perfNow = performance.now();

  switch (event.type) {
    case "RUN_STARTED": {
      // A late/out-of-order RUN_STARTED must never rewind a live run
      // (only a fresh run — or a full replay after reload — may reset).
      if (state.status !== "idle" && event.seq < state.maxSeq) return;
      state.status = "running";
      state.phase = "thinking";
      state.waitingKind = null;
      state.questionBatch = null;
      state.rows = [];
      state.workFinalized = false;
      state.reachedSolving = false;
      state.activeMs = 0;
      state.finalState = null;
      state.startedAt =
        typeof (event as { startedAt?: number }).startedAt === "number"
          ? (event as { startedAt: number }).startedAt
          : Date.now();
      state.endedAt = null;
      state.timer = createActiveTimer(perfNow);
      state.dirty = true;
      return;
    }

    case "ACTIVITY_STARTED": {
      const activity = (event as { activity?: ActivityNode }).activity;
      if (!activity || typeof activity.id !== "string") {
        state.malformed += 1;
        return;
      }
      const kind = mapViewKind(
        String(activity.kind ?? "tool"),
        String(activity.title ?? ""),
      );
      if (
        triggersSolving(kind) &&
        !state.workFinalized &&
        state.status !== "final"
      ) {
        // Latch for the FINAL label only — the live header is owned by
        // syncPhase (Solving strictly while the file row is in flight).
        state.reachedSolving = true;
      }
      // Defensive: real activity implicitly resumes a paused run.
      if (state.status === "waiting") resumeRun(state, perfNow);

      const children: ActivityViewChild[] = (activity.children ?? [])
        .filter((child) => child && typeof child.tool === "string")
        .map((child, index) => {
          if (child.tool === "read_file") {
            return makeChild(child.path, null, "Read");
          }
          if (child.tool === "search") {
            return {
              id: `${activity.id}-child-${index}`,
              label: redactDetail(`"${child.query}" — ${child.hits} result${child.hits === 1 ? "" : "s"}`),
              path: null,
              line: null,
            };
          }
          if (child.tool === "run_tests") {
            return {
              id: `${activity.id}-child-${index}`,
              label: redactDetail(
                `${child.target}${child.passed === null ? "" : child.passed ? " ✓" : " ✕"}`,
              ),
              path: null,
              line: null,
            };
          }
          const childPath = "path" in child && typeof child.path === "string" ? child.path : null;
          /** Human file-op prefixes — raw tool ids never reach the UI.
           * create_patch stays a bare path: the patch is composed here, not
           * applied, so the label must not claim an edit happened.
           * edit_file is ALSO bare: inside an "Edited N files" group the
           * dropdown reads as a clean file list (same as the read groups). */
          const TOOL_PREFIX: Record<string, string> = {
            edit_file: "",
            create_file: "Created",
            delete_file: "Deleted",
            rename_file: "Renamed",
            create_patch: "",
          };
          const prefix = TOOL_PREFIX[child.tool] ?? child.tool;
          return {
            id: `${activity.id}-child-${index}`,
            label: redactDetail(`${prefix}${childPath ? ` ${childPath}` : ""}`.trim()),
            path: childPath,
            line: null,
          };
        });

      appendRow(state, {
        id: activity.id,
        kind,
        title: safeTitle(activity.title, kind),
        detail: activity.summary ? redactDetail(activity.summary) : null,
        status: "running",
        seq: event.seq,
        children,
        groupCount: null,
      });
      return;
    }

    case "ACTIVITY_UPDATED": {
      const { activityId, patch } = event as {
        activityId: string;
        patch: Partial<Pick<ActivityNode, "title" | "summary" | "metadata">> & {
          status?: ActivityNode["status"];
        };
      };
      const row = state.rows.find((r) => r.id === activityId);
      if (!row) return; // START may have been grouped/missed — nothing to patch.
      if (event.seq < row.seq) return; // stale — never overwrite newer state.
      updateRowById(state, activityId, (current) => {
        const next: ActivityViewRow = { ...current, seq: Math.max(current.seq, event.seq) };
        // Title stays the fixed template for the row's kind (never free text);
        // patched summaries flow into the detail slot.
        if (typeof patch.summary === "string" && patch.summary.trim()) {
          next.detail = redactDetail(patch.summary);
        }
        if (patch.status === "completed") next.status = "completed";
        else if (patch.status === "failed") next.status = "failed";
        else if (patch.status === "cancelled") next.status = "cancelled";
        return next;
      });
      return;
    }

    case "ACTIVITY_COMPLETED": {
      const { activityId, summary } = event as {
        activityId: string;
        summary: string | null;
      };
      const row = state.rows.find((r) => r.id === activityId);
      if (!row) return;
      if (event.seq < row.seq) return;
      updateRowById(state, activityId, (current) => ({
        ...current,
        seq: Math.max(current.seq, event.seq),
        status: "completed",
        detail:
          typeof summary === "string" && summary.trim()
            ? redactDetail(summary)
            : current.detail,
      }));
      return;
    }

    case "SEARCH_RESULT": {
      const { query, hits } = event as {
        query: string;
        hits: number;
      };
      if (state.status === "waiting") resumeRun(state, perfNow);
      const safeQuery = redactDetail(String(query ?? ""));
      const hitCount = Number.isFinite(hits) ? Number(hits) : 0;
      const detail = safeQuery
        ? `"${safeQuery}" — ${hitCount} result${hitCount === 1 ? "" : "s"}`
        : null;

      /* The searched files do NOT render as children of this row — every
         referenced file arrives as its OWN "Reading <file>" timeline row
         (FILE_REFERENCED below), one by one, exactly like the prototype.
         The search row keeps the query chip on the line and the honest
         result count in its dropdown body. */
      const hostRow = [...state.rows].reverse().find((r) => r.kind === "repo_search");
      if (hostRow) {
        updateRowById(state, hostRow.id, (current) => ({
          ...current,
          seq: Math.max(current.seq, event.seq),
          detail: detail ?? current.detail,
          query: safeQuery || null,
        }));
      } else {
        appendRow(state, {
          id: `search-${event.seq}`,
          kind: "repo_search",
          title: titleForKind("repo_search"),
          detail,
          status: "completed",
          seq: event.seq,
          children: [],
          groupCount: null,
          query: safeQuery || null,
        });
      }
      return;
    }

    case "FILE_REFERENCED": {
      const { path, line } = event as { path: string; line: number | null };
      if (state.status === "waiting") resumeRun(state, perfNow);
      if (typeof path !== "string" || !path) {
        state.malformed += 1;
        return;
      }
      /* Every referenced file is its OWN timeline row — "Reading" + the
         file path chip on the line (prototype's one-by-one file loop).
         Consecutive reads then merge into ONE "Read N files" group row
         (appendRow's grouping) whose dropdown lists every file read. The
         running read rows drive the LIVE header (syncPhase → Solving while
         they are in flight); the latch only feeds the final label. */
      if (!state.workFinalized && state.status !== "final") {
        state.reachedSolving = true;
      }
      appendRow(state, {
        id: `read-${event.seq}`,
        kind: "read_file",
        title: titleForKind("read_file"),
        detail: null,
        status: "running",
        seq: event.seq,
        children: [makeChild(path, typeof line === "number" ? line : null, "")],
        groupCount: null,
      });
      return;
    }

    case "APPROVAL_REQUIRED": {
      if (!state.workFinalized && state.status === "running") {
        state.status = "waiting";
        state.waitingKind = "approval";
        pauseTimer(state.timer, perfNow);
        state.activeMs = readTimer(state.timer, perfNow);
      }
      appendRow(state, {
        id: `approval-${event.seq}`,
        kind: "waiting_approval",
        title: titleForKind("waiting_approval"),
        detail: null,
        status: "waiting",
        seq: event.seq,
        children: [],
        groupCount: null,
      });
      return;
    }

    case "INTAKE_QUESTIONS_REQUIRED": {
      if (!state.workFinalized && state.status === "running") {
        state.status = "waiting";
        state.waitingKind = "question";
        state.questionBatch =
          (event as { batch?: IntakeQuestionBatch }).batch ?? null;
        pauseTimer(state.timer, perfNow);
        state.activeMs = readTimer(state.timer, perfNow);
      }
      appendRow(state, {
        id: `question-${event.seq}`,
        kind: "waiting_question",
        title: titleForKind("waiting_question"),
        detail: null,
        status: "waiting",
        seq: event.seq,
        children: [],
        groupCount: null,
      });
      return;
    }

    case "QUESTION_REQUIRED": {
      // Single mid-run question (8.5 surface) — same waiting semantics.
      if (!state.workFinalized && state.status === "running") {
        state.status = "waiting";
        state.waitingKind = "question";
        pauseTimer(state.timer, perfNow);
        state.activeMs = readTimer(state.timer, perfNow);
      }
      appendRow(state, {
        id: `question-${event.seq}`,
        kind: "waiting_question",
        title: titleForKind("waiting_question"),
        detail: null,
        status: "waiting",
        seq: event.seq,
        children: [],
        groupCount: null,
      });
      return;
    }

    case "RESPONSE_CHUNK": {
      // FIRST final-answer chunk closes the work phase (spec A.6): freeze
      // the timer, finalize the timeline. Later chunks are no-ops.
      if (!state.workFinalized && state.status !== "final") {
        // A chunk while waiting means the user's answer landed and work
        // resumed — the wait is over, so the timer MUST leave the paused
        // state before it is frozen (never finalize while paused).
        if (state.status === "waiting") resumeRun(state, perfNow);
        state.workFinalized = true;
        state.activeMs = finalizeTimer(state.timer, perfNow);
        settleRunningRows(state, "completed");
        state.dirty = true;
      }
      return;
    }

    case "RUN_COMPLETED": {
      if (state.status === "final") return; // first terminal event wins
      if (state.status === "waiting") resumeRun(state, perfNow); // never finalize paused
      // When the FIRST final-answer chunk already froze the duration, keep
      // it frozen — the final label may never change twice.
      const wasWorkFinalized = state.workFinalized;
      state.workFinalized = true;
      state.status = "final";
      state.finalState = "completed";
      state.endedAt =
        typeof (event as { completedAt?: number }).completedAt === "number"
          ? (event as { completedAt: number }).completedAt
          : Date.now();
      if (!wasWorkFinalized) {
        state.activeMs = finalizeTimer(state.timer, perfNow);
      }
      settleRunningRows(state, "completed");
      state.dirty = true;
      return;
    }

    case "RUN_FAILED": {
      if (state.status === "final") return; // first terminal event wins
      if (state.status === "waiting") resumeRun(state, perfNow); // never finalize paused
      const wasWorkFinalized = state.workFinalized;
      state.workFinalized = true;
      state.status = "final";
      state.finalState = "failed";
      state.endedAt =
        typeof (event as { failedAt?: number }).failedAt === "number"
          ? (event as { failedAt: number }).failedAt
          : Date.now();
      if (!wasWorkFinalized) {
        state.activeMs = finalizeTimer(state.timer, perfNow);
      }
      settleRunningRows(state, "failed");
      const error = (event as { error?: string }).error;
      if (typeof error === "string" && error.trim()) {
        appendRow(state, {
          id: `error-${event.seq}`,
          kind: "error",
          title: titleForKind("error"),
          detail: redactDetail(error),
          status: "failed",
          seq: event.seq,
          children: [],
          groupCount: null,
        });
      }
      return;
    }

    case "RUN_CANCELLED": {
      if (state.status === "final") return; // first terminal event wins
      if (state.status === "waiting") resumeRun(state, perfNow); // never finalize paused
      const wasWorkFinalized = state.workFinalized;
      state.workFinalized = true;
      state.status = "final";
      state.finalState = "cancelled";
      state.endedAt =
        typeof (event as { cancelledAt?: number }).cancelledAt === "number"
          ? (event as { cancelledAt: number }).cancelledAt
          : Date.now();
      if (!wasWorkFinalized) {
        state.activeMs = finalizeTimer(state.timer, perfNow);
      }
      settleRunningRows(state, "cancelled");
      state.dirty = true;
      return;
    }

    case "CONTEXT_SNAPSHOT":
    case "MEMORY_USED":
      // 8C surfaces — consumed by the Context Inspector, not chain rows.
      return;

    default:
      state.malformed += 1;
      return;
  }
}

/** Resume a waiting run (user answered / defensive activity resume). */
function resumeRun(state: RunActivityState, perfNow: number): void {
  if (state.status !== "waiting") return;
  state.status = "running";
  state.waitingKind = null;
  state.questionBatch = null;
  resumeTimer(state.timer, perfNow);
  state.activeMs = readTimer(state.timer, perfNow);
  // The completed wait becomes part of the honest timeline (latest wait row).
  let completedWait = false;
  state.rows = state.rows.map((row) => {
    if (!completedWait && row.status === "waiting") {
      completedWait = true;
      return { ...row, status: "completed" };
    }
    return row;
  });
  state.dirty = true;
}

/* ------------------------------------------------------------------ */
/* Public ingestion                                                    */
/* ------------------------------------------------------------------ */

function looksLikeEvent(raw: unknown): raw is SequencedAssistantEvent {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "type" in raw &&
    typeof (raw as { type?: unknown }).type === "string" &&
    "runId" in raw &&
    typeof (raw as { runId?: unknown }).runId === "string" &&
    "seq" in raw &&
    typeof (raw as { seq?: unknown }).seq === "number" &&
    Number.isFinite((raw as { seq: number }).seq)
  );
}

/**
 * Ingest one REAL sequenced wire event (POST /api/assistant/runs SSE).
 * Idempotent: duplicates (same runId+seq) are ignored — reconnect replay
 * never duplicates rows; stale events never overwrite newer row state.
 */
export function ingestRunActivityEvent(event: SequencedAssistantEvent): void {
  if (!looksLikeEvent(event)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[cmx-activity] dropped malformed event");
    }
    return;
  }
  const state = ensureRun(event.runId);

  // Duplicate delivery (replay/reconnect) — ignore.
  if (state.processedSeqs.has(event.seq)) return;
  state.processedSeqs.add(event.seq);
  state.maxSeq = Math.max(state.maxSeq, event.seq);

  applyEvent(state, event);
  scheduleFlush();
}

/**
 * Ingest a LOCAL lifecycle event (client-side failure/cancel paths where no
 * wire event will arrive). The seq continues the run's sequence space.
 */
/** Distributive Omit — keeps every union member's own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type LocalRunActivityEvent = DistributiveOmit<SequencedAssistantEvent, "seq">;

export function ingestLocalRunActivityEvent(
  event: LocalRunActivityEvent,
): void {
  const state = ensureRun(event.runId);
  const seq = state.maxSeq + 1;
  ingestRunActivityEvent({ ...event, seq } as SequencedAssistantEvent);
}

/** Resume a paused run after the user answered (8C question flow). */
export function resumeRunActivity(runId: string): void {
  const state = runs.get(runId);
  if (!state) return;
  resumeRun(state, performance.now());
  scheduleFlush();
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/** Export the final chain for message persistence (reload keeps history). */
export function exportPersistedChain(runId: string): PersistedActivityChain | null {
  const state = runs.get(runId);
  if (!state || state.status !== "final") return null;
  return {
    version: 1,
    runId: state.runId,
    phase: state.phase,
    reachedSolving: state.reachedSolving,
    waitingKind: state.waitingKind,
    rows: state.rows.slice(-PERSISTED_ROW_CAP).map((row) => ({
      ...row,
      children: row.children.map((child) => ({ ...child })),
    })),
    hiddenEarlierCount: Math.max(0, state.rows.length - PERSISTED_ROW_CAP),
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    activeMs: state.activeMs,
    finalState: state.finalState,
  };
}

/** Build a static snapshot from a persisted chain (history rendering). */
export function snapshotFromPersistedChain(
  chain: PersistedActivityChain,
): RunActivitySnapshot {
  return {
    runId: chain.runId,
    status: "final",
    phase: chain.phase,
    waitingKind: chain.waitingKind,
    questionBatch: null,
    rows: chain.rows,
    hiddenEarlierCount: chain.hiddenEarlierCount,
    workFinalized: true,
    reachedSolving: chain.reachedSolving,
    activeMs: chain.activeMs ?? 0,
    finalState: chain.finalState,
    startedAt: chain.startedAt,
    endedAt: chain.endedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Verification harness (window.__cmxRunActivityDebug)                 */
/* ------------------------------------------------------------------ */

/** Read-only observation for browser-driven verification. */
export function getRunActivityDebug(): {
  runs: number;
  active: string[];
  malformedByRun: Record<string, number>;
} {
  const active: string[] = [];
  const malformedByRun: Record<string, number> = {};
  for (const [runId, state] of runs) {
    if (state.status !== "final") active.push(runId);
    if (state.malformed > 0) malformedByRun[runId] = state.malformed;
  }
  return { runs: runs.size, active, malformedByRun };
}
