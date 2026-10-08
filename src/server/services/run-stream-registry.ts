/**
 * CodeMind X V2 — Agent Mode V2 run-stream registry.
 *
 * The chat run stream is now SPLIT ACROSS CONNECTIONS (Agent Mode V2 spec
 * §5/§31/§56/§110): a mutating run PAUSES at the approval gate (or the
 * intake-question pause) and the phase-1 SSE response ENDS — the network
 * path kills idle SSE connections at ~3.5min, so holding the stream open
 * for a human decision strands the client on a dead connection. The run
 * itself continues server-side; the client later opens a RESUME stream
 * (POST /api/assistant/runs/resume) and receives a full ordered REPLAY of
 * every frame plus the live remainder.
 *
 * This registry is the per-run frame ledger that makes that possible:
 * - every sequenced frame (wire events, the result frame, error frames) is
 *   assigned ONE monotonic per-run seq HERE — phase-1 and resume streams
 *   therefore share a single seq space and the client's dedupe stays exact;
 * - frames are buffered (bounded) so a resume that opens after new frames
 *   were emitted never loses them;
 * - subscribers receive frames synchronously in emission order (the phase-1
 *   pump and the resume pump are both just subscribers);
 * - the orchestrator run mapping (assistant runId → AgentRun publicId)
 *   lives here so the cancel route can reach the engine gate.
 *
 * globalThis singleton — same Turbopack per-route module-copy constraint as
 * the orchestrator ACTIVE_RUNS registry.
 */

import type {
  AssistantStreamEvent,
  SequencedAssistantEvent,
} from "@/features/workspace/assistant/contracts";

/** One buffered frame in a run's stream. */
export type RunStreamFrame =
  | { kind: "event"; event: SequencedAssistantEvent }
  | { kind: "result"; frame: Record<string, unknown> }
  | { kind: "error"; message: string };

export type RunPauseReason = "approval" | "answers";

export interface RunPauseInfo {
  reason: RunPauseReason;
  approvalId?: string;
  orchestratorRunId?: string;
}

interface RunStreamState {
  runId: string;
  seq: number;
  frames: RunStreamFrame[];
  subscribers: Set<(frame: RunStreamFrame) => void>;
  /** Set once the phase-1 stream paused (RUN_PAUSED emitted + response end). */
  paused: RunPauseInfo | null;
  /** Set once the run reached a terminal frame — buffers become replay-only. */
  ended: boolean;
  orchestratorRunId: string | null;
  createdAt: number;
}

/** Hard frame cap: the client render cap is 200 rows; the ledger keeps
 *  generous headroom for search/file child events while staying bounded. */
const FRAME_CAP = 800;

/** How long a TERMINAL run's ledger stays available for late resumes. */
const ENDED_LEDGER_TTL_MS = 15 * 60_000;

interface RegistryGlobal {
  __cmxRunStreamRegistry?: Map<string, RunStreamState>;
}
const globalStore = globalThis as unknown as RegistryGlobal;
const registry: Map<string, RunStreamState> =
  globalStore.__cmxRunStreamRegistry ?? new Map<string, RunStreamState>();
globalStore.__cmxRunStreamRegistry = registry;

function getState(runId: string): RunStreamState | null {
  return registry.get(runId) ?? null;
}

function ensureState(runId: string): RunStreamState {
  let state = registry.get(runId);
  if (!state) {
    state = {
      runId,
      seq: 0,
      frames: [],
      subscribers: new Set(),
      paused: null,
      ended: false,
      orchestratorRunId: null,
      createdAt: Date.now(),
    };
    registry.set(runId, state);
  }
  return state;
}

function pushFrame(state: RunStreamState, frame: RunStreamFrame): void {
  state.frames.push(frame);
  if (state.frames.length > FRAME_CAP) {
    // Keep the FIRST frame (RUN_STARTED — the client's replay anchor) and
    // the newest tail; drop the oldest middle frames. Real runs stay far
    // below this cap (200 rendered rows + child events).
    state.frames.splice(1, state.frames.length - FRAME_CAP);
  }
  for (const subscriber of state.subscribers) {
    try {
      subscriber(frame);
    } catch {
      // A broken pump must never corrupt the ledger for other consumers.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Open (or re-open) the ledger for a run. Idempotent. */
export function openRunStream(runId: string): void {
  ensureState(runId);
}

/**
 * Emit one sequenced wire event: assigns the run's NEXT seq, buffers the
 * frame, and notifies every live subscriber synchronously in order.
 */
export function emitRunEvent(
  runId: string,
  event: AssistantStreamEvent,
): SequencedAssistantEvent {
  const state = ensureState(runId);
  state.seq += 1;
  const sequenced = { ...event, seq: state.seq } as SequencedAssistantEvent;
  pushFrame(state, { kind: "event", event: sequenced });
  return sequenced;
}

/** Buffer + broadcast the transport-only result frame (shares seq space). */
export function emitResultFrame(
  runId: string,
  frame: Record<string, unknown>,
): void {
  const state = ensureState(runId);
  state.seq += 1;
  pushFrame(state, { kind: "result", frame: { ...frame, seq: state.seq } });
}

/** Buffer + broadcast a terminal transport error frame. */
export function emitErrorFrame(runId: string, message: string): void {
  const state = ensureState(runId);
  pushFrame(state, { kind: "error", message });
}

/** Mark the run terminal; the ledger stays readable for late resumes. */
export function endRunStream(runId: string): void {
  const state = registry.get(runId);
  if (!state) return;
  state.ended = true;
  state.subscribers.clear();
  setTimeout(
    () => {
      const current = registry.get(runId);
      // Only reap if still terminal — a fresh run reuses the id never
      // happens (run ids are UUIDs), the TTL is pure GC.
      if (current && current.ended) registry.delete(runId);
    },
    ENDED_LEDGER_TTL_MS,
  ).unref?.();
}

/**
 * Subscribe to a run's frames. Delivers the BACKLOG first (frames with
 * seq > fromSeq, in order — fromSeq 0 = full replay), then live frames.
 * Returns the current subscriber handle + whether a ledger exists.
 */
export function subscribeRunFrames(
  runId: string,
  fromSeq: number,
  onFrame: (frame: RunStreamFrame) => void,
): { unsubscribe: () => void; exists: boolean } {
  const state = getState(runId);
  if (!state) return { unsubscribe: () => undefined, exists: false };

  for (const frame of state.frames) {
    const seq = frame.kind === "event" ? frame.event.seq : frame.kind === "result" ? Number(frame.frame.seq ?? 0) : null;
    if (seq !== null && seq <= fromSeq) continue;
    onFrame(frame);
  }
  state.subscribers.add(onFrame);
  return {
    exists: true,
    unsubscribe: () => {
      state.subscribers.delete(onFrame);
    },
  };
}

/** Record the pause (RUN_PAUSED bookkeeping for reconnect decisions). */
export function markRunPaused(runId: string, info: RunPauseInfo): void {
  const state = ensureState(runId);
  state.paused = info;
}

export function getRunPause(runId: string): RunPauseInfo | null {
  return getState(runId)?.paused ?? null;
}

/** Associate the assistant run with its orchestrator AgentRun publicId. */
export function setOrchestratorMapping(
  runId: string,
  orchestratorRunId: string,
): void {
  const state = ensureState(runId);
  state.orchestratorRunId = orchestratorRunId;
}

export function getOrchestratorMapping(runId: string): string | null {
  return getState(runId)?.orchestratorRunId ?? null;
}

export function hasRunStream(runId: string): boolean {
  return registry.has(runId);
}

/** Last seq handed out for this run (reconnect accounting). */
export function getRunStreamLastSeq(runId: string): number {
  return getState(runId)?.seq ?? 0;
}
