"use client";

/**
 * CodeMind X V2 — assistant run hook (spec §18/§29; Phase 8B update).
 *
 * Drives the ACTIVE conversation's assistant completions against the real
 * streaming run surface (POST /api/assistant/runs) and feeds the returned
 * sequenced events straight into the shared ActivityEngine — the backend is
 * the single source of truth for what the run is doing.
 *
 * Per-message activity chains are derived from the ENGINE snapshot (safe
 * execution summaries only — never chain-of-thought) and persisted onto the
 * message so history keeps the real chain after the engine moves on.
 *
 * Honesty rules (RULES.md §9):
 * - errors carry the backend's real error message (never a fake success),
 * - a stopped request is recorded as "stopped"/RUN_CANCELLED, never an answer,
 * - `runPhase` describes in-flight work only and returns to "idle" on every
 *   terminal outcome,
 * - the first-event latency and total duration are MEASURED, never invented.
 */

import { useCallback, useEffect, useRef } from "react";

import {
  selectActiveConversation,
  useWorkspaceStore,
} from "@/stores/workspace-store";
import type {
  Attachment,
  ChatMessage,
} from "@/features/workspace/types";
import type {
  ComposerMode,
  IntakeAnswer,
  SequencedAssistantEvent,
} from "../assistant/contracts";
import {
  applyWireEvent,
  assistantActivityEngine,
  createRunId,
  exposeAssistantTooling,
  noteTransportSeq,
  recordFirstEventLatency,
  resumeRunFromAwaiting,
  runCancelled,
  runFailed,
  runStarted,
} from "../assistant";
import {
  armSendScrollGate,
  releaseSendScrollGate,
  waitForSendScrollArrival,
} from "./activity/send-scroll-gate";
import {
  exportPersistedChain,
  exportPausedChain,
  getRunMaxSeq,
  ingestLocalRunActivityEvent,
  resumeRunActivity,
} from "./activity/run-activity-store";
import { createChainPacer } from "./activity/chain-pacer";
import { createAnswerPacer } from "./activity/answer-pacer";
import {
  armChainCloseGate,
  logChainGate,
  resetChainCloseGate,
  waitForChainFullyClosed,
} from "./activity/chain-close-gate";

/* Verification tooling (window.__cmxAssistant, read-only observation). */
exposeAssistantTooling();

/** Wire format of one chat message (1..30 messages, each ≤ 8000 chars). */
interface ApiChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Wire shape of one composer attachment (Phase 8A typed contract). */
interface ApiChatAttachment {
  kind: "repository-file" | "selection" | "session-file";
  label: string;
  path: string | null;
}

/** Transport-only frame carrying the complete answer (SSE contract). */
interface RunResultFrame {
  seq: number;
  content: string;
  servedModel: string | null;
  mode: string;
  note: string;
}

/**
 * Explicit context the composer attached to THIS run (Phase 8A §2
 * "context selection"). All fields are real when present, null otherwise.
 */
export interface AssistantSendContext {
  repository: string | null;
  branch: string | null;
  currentFile: string | null;
  selectedCode: string | null;
}

/** The user's Context Inspector ledger, enforced server-side per run (8C). */
export interface AssistantContextLedger {
  /** Refs removed by the user — filtered from retrieval; never silently return. */
  excludedRefs: string[];
  /** Memory ids disabled for this request — never reach the model. */
  excludedMemoryIds: string[];
  /** Refs pinned by the user — read like attachments on every run. */
  pinnedRefs: string[];
}

export interface AssistantSendOptions {
  mode: ComposerMode;
  /** Requested gateway model id; null = gateway default. */
  model: string | null;
  context: AssistantSendContext;
  /** 8C: the user's pin/remove/memory-disable ledger (defaults to empty). */
  ledger?: AssistantContextLedger;
  /**
   * Phase 9.5 — per-run memory policy (spec §13 + §9). incognito: no new
   * persistent memory is created from this run; readsDisabled: memory is
   * not consulted at all; depth: one-click adaptive-depth override.
   */
  memory?: { incognito?: boolean; readsDisabled?: boolean; depth?: "beginner" | "standard" | "expert" };
}

/** Prior-context window sent to the API (backend also caps at 30 messages). */
const MAX_PAYLOAD_MESSAGES = 20;
/** Hard transport cap per message, mirroring the backend schema (8000 chars). */
const MAX_PAYLOAD_CHARS = 8_000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function capContent(content: string): string {
  return content.length > MAX_PAYLOAD_CHARS
    ? content.slice(0, MAX_PAYLOAD_CHARS)
    : content;
}

/** Messages with real text content only — empty placeholders never go on the wire. */
function toPayloadMessages(
  messages: Pick<ChatMessageLike, "role" | "content">[],
): ApiChatMessage[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_PAYLOAD_MESSAGES)
    .map((m) => ({ role: m.role, content: capContent(m.content) }));
}

/** Structural subset of ChatMessage needed here (keeps imports minimal). */
interface ChatMessageLike {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * The in-flight request controller, module-scoped so that ANY hook instance
 * (composer, message list) can stop the current completion. Phase 2 serializes
 * assistant runs (runPhase is global), so at most one controller exists.
 */
let activeController: AbortController | null = null;

/**
 * Scroll-on-send handshake (user mandate, RULES.md §15): a send has armed
 * the scroll gate and is waiting for ConversationView to arrive at the
 * newly pinned question before the run — and with it the thought chain —
 * starts. Module-scoped like activeController so EVERY hook instance
 * respects the pending start (double-send and regenerate are blocked).
 */
let pendingRunStart = false;

export interface AssistantRun {
  send: (
    conversationId: string,
    content: string,
    attachments?: Attachment[],
    options?: AssistantSendOptions,
  ) => void;
  stop: () => void;
  regenerate: () => void;
  /** 8C: deliver answers to the paused run (resumes it on success). */
  answerIntake: (
    conversationId: string,
    messageId: string,
    runId: string,
    answers: IntakeAnswer[],
  ) => Promise<boolean>;
  /** Agent Mode V2: record the human decision on the approval card inside
   *  the thought chain and resume the SAME run (spec §3/§5/§51). */
  decideApproval: (
    conversationId: string,
    messageId: string,
    approvalId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
  isGenerating: boolean;
}

/* ------------------------------------------------------------------ */
/* SSE frame parsing                                                   */
/* ------------------------------------------------------------------ */

type WireFrame =
  | { kind: "event"; event: SequencedAssistantEvent }
  | { kind: "result"; frame: RunResultFrame }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

/* ------------------------------------------------------------------ */
/* Agent Mode V2 — pause/resume run state                              */
/* ------------------------------------------------------------------ */

/**
 * The run the user is currently DECIDING on (spec §110): while set, the
 * client's Stop button must cancel through the dedicated route (the
 * phase-1 fetch is gone) instead of aborting a live stream.
 */
interface PausedRun {
  runId: string;
  conversationId: string;
  messageId: string;
}
let pausedRun: PausedRun | null = null;

/**
 * Replay guard (Agent Mode V2 resume): the resume stream replays the run's
 * full event history with the SAME seq space. The per-run chain store
 * dedupes by seq; the activity ENGINE gets the same protection here — an
 * event whose seq was already applied is not applied twice.
 */
const appliedSeqByRun = new Map<string, number>();
function applyWireEventGuarded(event: SequencedAssistantEvent): void {
  const last = appliedSeqByRun.get(event.runId) ?? 0;
  if (event.seq <= last) return;
  appliedSeqByRun.set(event.runId, event.seq);
  applyWireEvent(event);
}

/* ------------------------------------------------------------------ */
/* SSE frame parsing                                                   */
/* ------------------------------------------------------------------ */

/** Parse one SSE frame (`event: X\ndata: {...}`) into a typed union. */
function parseWireFrame(raw: string): WireFrame {
  let eventName = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return { kind: "unknown" };
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (eventName === "result") {
      return {
        kind: "result",
        frame: parsed as unknown as RunResultFrame,
      };
    }
    if (eventName === "error") {
      return {
        kind: "error",
        message: typeof parsed.error === "string" ? parsed.error : "The assistant run failed.",
      };
    }
    if (typeof parsed.type === "string" && typeof parsed.seq === "number") {
      return { kind: "event", event: parsed as unknown as SequencedAssistantEvent };
    }
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useAssistantRun(): AssistantRun {
  /** Per-instance re-entrancy guard (module controller is the global one). */
  const generatingRef = useRef(false);

  const isGenerating = useWorkspaceStore((s) => {
    const active = selectActiveConversation(s);
    return active?.status === "generating" || s.runPhase === "thinking";
  });

  const stop = useCallback(() => {
    // Agent Mode V2 (spec §110): a PAUSED run has no live fetch to abort —
    // cancel it through the dedicated route and settle honestly.
    if (pausedRun) {
      const target = pausedRun;
      pausedRun = null;
      void fetch("/api/assistant/runs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: target.runId }),
      }).catch(() => undefined);
      runCancelled(target.runId);
      ingestLocalRunActivityEvent({
        type: "RUN_CANCELLED",
        runId: target.runId,
        cancelledAt: Date.now(),
      });
      useWorkspaceStore
        .getState()
        .updateMessage(target.conversationId, target.messageId, { state: "stopped" });
      useWorkspaceStore.getState().setConversationStatus(target.conversationId, "stopped");
      return;
    }
    activeController?.abort();
  }, []);

  /* Unmount cleanup: abort any in-flight completion this surface started. */
  useEffect(() => {
    return () => {
      activeController?.abort();
    };
  }, []);

  /**
   * Shared completion pipeline: appends the assistant placeholder, opens the
   * real run stream, applies every sequenced wire event to the engine, and
   * records the honest terminal state.
   */
  const runCompletion = useCallback(
    async (
      conversationId: string,
      history: ApiChatMessage[],
      options?: AssistantSendOptions,
      wireAttachments?: ApiChatAttachment[],
      /** Agent Mode V2: resume an EXISTING paused run instead of starting a
       *  new one — reuses the message, replays the run's event history. */
      resume?: { runId: string; messageId: string },
    ) => {
      if (generatingRef.current || activeController) return;

      const store = useWorkspaceStore.getState();
      let assistantMsgId: string | null;
      if (resume) {
        assistantMsgId = resume.messageId;
        pausedRun = null;
      } else {
        assistantMsgId = store.appendMessage(conversationId, {
          role: "assistant",
          content: "",
        });
      }
      if (assistantMsgId === null) return;

      const startedWallClock = Date.now();
      const t0 = performance.now();

      store.setConversationStatus(conversationId, "generating");
      store.setRunPhase("thinking");

      generatingRef.current = true;
      const controller = new AbortController();
      activeController = controller;

      const activeFile = options?.context.currentFile ?? undefined;
      const hasContext =
        Boolean(activeFile) ||
        Boolean(options?.context.repository) ||
        Boolean(options?.context.branch) ||
        Boolean(options?.context.selectedCode) ||
        (wireAttachments?.length ?? 0) > 0;

      let wireRunId: string | null = resume?.runId ?? null;
      let sawWireRunStart = Boolean(resume);
      let firstEventRecorded = false;
      let resultFrame: RunResultFrame | null = null;
      /** Agent Mode V2: seqs ≤ this are REPLAY on a resume stream — their
       *  RUN_PAUSED must not re-trigger the pause path. */
      const replayCeiling = resume ? getRunMaxSeq(resume.runId) : 0;
      /** Any terminal frame (or transport result) seen this stream — a
       *  replayed RUN_PAUSED followed by RUN_COMPLETED is a COMPLETED run,
       *  never a pause (the replay delivers the whole history). */
      let sawTerminalFrame = false;
      /** Agent Mode V2: the run paused server-side (approval/answers).
       *  Held in a wrapper object — the handler closure mutates it while
       *  the stream loop runs (a bare `let` would be control-flow-narrowed
       *  to null by TypeScript). */
      const pauseState: {
        info: {
          reason: "approval" | "answers";
          approvalId?: string;
          orchestratorRunId?: string;
        } | null;
      } = { info: null };

      /* ---- Phase 9 + 9.1: the two presentation pacers (both honest) ----
       * chainPacer — display smoothing of REAL chain events (thinking first,
       * steps one-by-one, visible dwell); the engine + message metadata stay
       * immediate.
       * answerPacer — word-by-word reveal of REAL streamed deltas
       * (45ms/word, adaptive catch-up); flushAll guarantees the full answer
       * is visible at every terminal state.
       *
       * Phase 9.1 GATE (user direction): writing starts only after the FULL
       * thought chain completes — streamed deltas are buffered honestly
       * until the chain pacer releases the first chunk (the chain-close
       * moment, right as "Thought for Xs" lands), then the reveal begins.
       * Nothing is invented: the buffer only ever holds real received text.
       *
       * Phase 9.2 GATE (user mandate, RULES.md §15 "Thought Chain Working
       * Phase"): the response starts ONLY after the chain has FULLY closed —
       * the last row's 1.5s loader ended AND the one-shot close landed. The
       * close machine in ActivityChain releases chain-close-gate at exactly
       * that moment; until then the real text stays buffered (never shown
       * early), then reveals word-by-word with the frozen answer rhythm.
       * Errors, stops and empty responses stay blunt and immediate. */
      let answerRevealStarted = false;
      /** startAnswerReveal armed the chain-close wait (runs at most once). */
      let revealWaitStarted = false;
      /** A terminal error/stop path flushed everything — a late gate release
       * must never feed the pacer after that. */
      let terminalFlushed = false;
      let answerBuffer = "";
      let deferredSyncFull: string | null = null;
      let pendingDrain: (() => void) | null = null;
      /** A real RESPONSE_CHUNK arrived from the wire (release may lag). */
      let sawAnswerChunk = false;

      const answerPacer = createAnswerPacer((revealed) => {
        useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
          content: revealed,
        });
      });

      /** Feed the buffered real answer into the pacer + settle the drain. */
      const beginAnswerReveal = (): void => {
        logChainGate("answer-begin", answerBuffer.length);
        if (answerRevealStarted || terminalFlushed) return;
        answerRevealStarted = true;
        if (answerBuffer) answerPacer.push(answerBuffer);
        answerBuffer = "";
        if (deferredSyncFull !== null) {
          answerPacer.syncFull(deferredSyncFull);
          deferredSyncFull = null;
        }
        const drain = pendingDrain;
        pendingDrain = null;
        if (drain) answerPacer.drain(drain);
      };

      /**
       * The chain story released its first chunk → hold the buffered answer
       * until the chain has FULLY closed (9.2 mandate: loader ended + one-
       * shot close — ActivityChain releases the gate at that exact moment),
       * then start the reveal. Bounded wait: a missing/unmounted view can
       * never stall a real answer.
       */
      const startAnswerReveal = (): void => {
        if (answerRevealStarted || revealWaitStarted) return;
        revealWaitStarted = true;
        armChainCloseGate();
        void waitForChainFullyClosed().then(beginAnswerReveal);
      };

      const chainPacer = createChainPacer({ onAnswerReady: startAnswerReveal });

      /** Drain AFTER the reveal has started (terminal states). */
      const revealThenDrain = (onDone: () => void): void => {
        if (answerRevealStarted) {
          answerPacer.drain(onDone);
          return;
        }
        // The reveal is gated on the chain's FULL close (9.2 mandate) — the
        // terminal drain fires right after the gated reveal feeds the pacer
        // (startAnswerReveal is idempotent; the chain pacer's onAnswerReady
        // may arm the same wait first).
        pendingDrain = onDone;
        startAnswerReveal();
      };

      /** Terminal chain export — persists the completed timeline (8D). */
      const persistActivityChain = (): void => {
        if (!wireRunId) return;
        const chain = exportPersistedChain(wireRunId);
        if (chain) {
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            activityChain: chain,
            // Active work time (waiting excluded) — the duration behind the
            // chain's final label, more honest than wall-clock time.
            thoughtForMs: chain.activeMs,
          });
        }
      };

      /** Apply one sequenced wire event; keep the message chain in sync. */
      const handleWireEvent = (event: SequencedAssistantEvent): void => {
        if (event.type === "RUN_STARTED") {
          sawWireRunStart = true;
          wireRunId = event.runId;
        }
        // Engine first: RUN_STARTED resets the run metrics; the measured
        // latency is recorded against the NEW run right after. Replay-safe
        // (the resume stream re-delivers the run's history — seq-guarded).
        applyWireEventGuarded(event);
        // 8D + Phase 9: the same real event feeds the per-run activity chain
        // store through the display pacer (order-preserving, terminal/intake
        // events never wait).
        chainPacer.ingest(event);
        // Phase 9: real streamed answer deltas reveal word by word — but
        // 9.1: only AFTER the chain story completes. Until then they are
        // buffered verbatim (still real, still in order).
        if (event.type === "RESPONSE_CHUNK" && event.segment.kind === "markdown") {
          sawAnswerChunk = true;
          if (answerRevealStarted) answerPacer.push(event.segment.text);
          else answerBuffer += event.segment.text;
        }
        if (!firstEventRecorded) {
          firstEventRecorded = true;
          if (wireRunId) recordFirstEventLatency(wireRunId, performance.now() - t0);
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            firstEventMs: Math.round(performance.now() - t0),
          });
        }
        // 8C surfaces: persist the run's measured facts onto the message so
        // history keeps the truth after the engine moves on.
        if (event.type === "CONTEXT_SNAPSHOT") {
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            contextSnapshot: event.snapshot,
          });
        } else if (event.type === "MEMORY_USED") {
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            memories: event.memories,
            memoryNote: event.note,
          });
        } else if (event.type === "INTAKE_QUESTIONS_REQUIRED") {
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            questionBatch: event.batch,
          });
        } else if (event.type === "APPROVAL_REQUIRED") {
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            approval: event.approval,
          });
        } else if (event.type === "APPROVAL_DECIDED") {
          // Agent Mode V2: mirrors the decision onto the message (important
          // for RELOAD resumes — the decision may have been recorded
          // server-side before the client reconnected).
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            approvalDecision: event.decision,
          });
        } else if (event.type === "CHANGE_RESULT") {
          // The machine-generated result of the REAL mutation (spec §81) —
          // the chat result card renders exactly this. The repository
          // explorer reloads so created/modified/deleted files actually
          // appear on disk-backed truth (spec §124).
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            changeResult: event.result,
          });
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("cmx:repository-mutated"));
          }
        } else if (event.type === "RUN_PAUSED") {
          // Agent Mode V2 (spec §5): the run paused server-side. The stream
          // ends after this frame; the message enters the honest waiting
          // state and the user decides (approval) or answers (questions).
          // REPLAY GUARD: on a resume stream the phase-1 pause is re-
          // delivered — only a pause BEYOND the replay point counts.
          if (event.seq > replayCeiling) {
            pauseState.info = {
              reason: event.reason,
              approvalId: event.approvalId,
              orchestratorRunId: event.orchestratorRunId,
            };
          }
        } else if (event.type === "RESPONSE_STRUCTURED") {
          // 8.5: the typed structured payload — the UI renders THIS, never
          // parsed markdown. Persisted with the message like the other
          // measured run facts.
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            structured: event.structured,
          });
        } else if (event.type === "RUN_STARTED") {
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            runId: event.runId,
          });
        }
      };

      try {
        const res = await fetch(
          resume ? "/api/assistant/runs/resume" : "/api/assistant/runs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: resume
              ? JSON.stringify({ runId: resume.runId, fromSeq: 0 })
              : JSON.stringify({
                  messages: history,
                  mode: options?.mode,
                  model: options?.model ?? undefined,
                  memory:
                    options?.memory &&
                    (options.memory.incognito || options.memory.readsDisabled || options.memory.depth)
                      ? {
                          incognito: options.memory.incognito || undefined,
                          readsDisabled: options.memory.readsDisabled || undefined,
                          depth: options.memory.depth || undefined,
                        }
                      : undefined,
                  context: hasContext
                    ? {
                        repository: options?.context.repository ?? undefined,
                        branch: options?.context.branch ?? undefined,
                        activeFile,
                        selectedCode: options?.context.selectedCode ?? undefined,
                        attachments:
                          wireAttachments && wireAttachments.length > 0
                            ? wireAttachments
                            : undefined,
                        /* 8C ledger — the user's context controls, enforced server-side. */
                        excludedRefs:
                          options?.ledger && options.ledger.excludedRefs.length > 0
                            ? options.ledger.excludedRefs
                            : undefined,
                        excludedMemoryIds:
                          options?.ledger && options.ledger.excludedMemoryIds.length > 0
                            ? options.ledger.excludedMemoryIds
                            : undefined,
                        pinnedRefs:
                          options?.ledger && options.ledger.pinnedRefs.length > 0
                            ? options.ledger.pinnedRefs
                            : undefined,
                      }
                    : undefined,
                }),
            signal: controller.signal,
          },
        );

        // Validation/transport failures arrive as a plain JSON envelope
        // BEFORE any stream opens — surface the real error honestly.
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; error?: string }
            | null;
          const error =
            typeof data?.error === "string" && data.error.trim().length > 0
              ? data.error
              : `The assistant request failed (HTTP ${res.status}).`;
          // The run started client-side even if the server rejected it.
          if (!sawWireRunStart) {
            const localRunId = createRunId();
            runStarted(localRunId, conversationId);
            wireRunId = localRunId;
          }
          throw new Error(error);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let errorMessage: string | null = null;

        stream: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            const frame = parseWireFrame(raw);
            switch (frame.kind) {
              case "event": {
                if (frame.event.type === "RUN_FAILED") {
                  errorMessage = frame.event.error;
                }
                handleWireEvent(frame.event);
                break;
              }
              case "result": {
                resultFrame = frame.frame;
                // The transport frame shares the run's seq space — account
                // for it so gap detection stays exact.
                if (wireRunId && typeof frame.frame.seq === "number") {
                  noteTransportSeq(wireRunId, frame.frame.seq);
                }
                // Phase 9: the final content is authoritative — sync the
                // reveal buffer (grows only) and record run meta. The answer
                // keeps streaming word by word until the terminal flush.
                // 9.1: if the chain is still playing, the sync is deferred
                // to startAnswerReveal so the full text never jumps early.
                if (answerRevealStarted) answerPacer.syncFull(frame.frame.content);
                else deferredSyncFull = frame.frame.content;
                useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
                  servedModel: frame.frame.servedModel,
                  mode: (frame.frame.mode as ComposerMode) ?? options?.mode,
                });
                break;
              }
              case "error": {
                errorMessage = frame.message;
                break;
              }
              case "unknown":
                break;
            }
            if (
              frame.kind === "event" &&
              (frame.event.type === "RUN_COMPLETED" ||
                frame.event.type === "RUN_FAILED" ||
                frame.event.type === "RUN_CANCELLED")
            ) {
              sawTerminalFrame = true;
              break stream;
            }
            if (frame.kind === "result") {
              sawTerminalFrame = true;
            }
          }
        }

        /* ---- Agent Mode V2: the run PAUSED server-side (spec §5/§31) ----
         * The phase-1 stream ended after RUN_PAUSED. The chain stays OPEN
         * with the waiting row visible, the message records the honest
         * waiting state, and the run's continuation arrives through the
         * resume stream (user decision / answers → decideApproval /
         * answerIntake → resumeCompletion). The chain is persisted in its
         * PAUSED shape (exportPausedChain) so a reload restores the open
         * waiting state, never a fake final history (spec §110).
         * A terminal frame wins: a replayed pause + RUN_COMPLETED is a
         * COMPLETED run. */
        const pausedInfo = pauseState.info;
        if (pausedInfo !== null && !sawTerminalFrame) {
          chainPacer.flushAll();
          chainPacer.dispose();
          answerPacer.dispose();
          const pausedChain = wireRunId ? exportPausedChain(wireRunId) : null;
          const waitingPatch: {
            state: ChatMessage["state"];
            waitingKind: NonNullable<ChatMessage["waitingKind"]>;
            activityChain?: NonNullable<ChatMessage["activityChain"]>;
          } = {
            state: "waiting",
            waitingKind: pausedInfo.reason === "approval" ? "approval" : "question",
          };
          if (pausedChain) waitingPatch.activityChain = pausedChain;
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, waitingPatch);
          pausedRun = {
            runId: wireRunId ?? "",
            conversationId,
            messageId: assistantMsgId,
          };
          useWorkspaceStore.getState().setConversationStatus(conversationId, "active");
          return;
        }

        if (errorMessage !== null) {
          // The engine already applied RUN_FAILED from the wire; mirror the
          // terminal state on the message with the backend's real error.
          // Failures stay blunt and immediate — never gated on the close.
          terminalFlushed = true;
          resetChainCloseGate();
          chainPacer.flushAll();
          answerPacer.flushAll();
          persistActivityChain();
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            state: "error",
            error: errorMessage,
          });
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "error");
        } else {
          const snapshot = assistantActivityEngine.getSnapshot();
          const finalContent = resultFrame?.content ?? null;
          const completedOk =
            finalContent !== null &&
            finalContent.trim().length > 0 &&
            snapshot.status === "completed";
          if (completedOk) {
            // Keep the word-by-word rhythm until the reveal finishes, then
            // settle any remaining paced chain events and persist the final
            // state. Do NOT flush the chain pacer here — on fast runs the
            // story is still animating and must finish before the final
            // label lands. 9.1: if the story is still playing, the reveal
            // (and thus this drain) starts only when the chain completes.
            revealThenDrain(() => {
              chainPacer.flushAll();
              chainPacer.dispose();
              persistActivityChain();
              useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
                state: "complete",
                content: finalContent ?? undefined,
                thoughtForMs:
                  (wireRunId ? exportPersistedChain(wireRunId)?.activeMs : null) ??
                  snapshot.durationMs,
              });
              useWorkspaceStore
                .getState()
                .setConversationStatus(conversationId, "completed");
              // The reveal owned its own lifecycle — done now.
              answerPacer.dispose();
            });
          } else if (resultFrame !== null && resultFrame.content.trim().length > 0) {
            // Content arrived but the stream ended without RUN_COMPLETED —
            // finish honestly from the measured facts we DO have.
            if (wireRunId) {
              chainPacer.flushAll();
              ingestLocalRunActivityEvent({
                type: "RUN_COMPLETED",
                runId: wireRunId,
                completedAt: Date.now(),
              });
            }
            revealThenDrain(() => {
              chainPacer.flushAll();
              chainPacer.dispose();
              persistActivityChain();
              useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
                state: "complete",
                content: resultFrame?.content ?? "",
                thoughtForMs: Date.now() - startedWallClock,
              });
              useWorkspaceStore
                .getState()
                .setConversationStatus(conversationId, "completed");
              answerPacer.dispose();
            });
          } else {
            const error =
              "The assistant returned an empty response.";
            terminalFlushed = true;
            resetChainCloseGate();
            if (!sawWireRunStart) {
              const localRunId = createRunId();
              runStarted(localRunId, conversationId);
              wireRunId = localRunId;
              chainPacer.flushAll();
              ingestLocalRunActivityEvent({
                type: "RUN_STARTED",
                runId: localRunId,
                conversationId,
                startedAt: startedWallClock,
                mode: options?.mode ?? "agent",
              });
            }
            if (wireRunId) {
              runFailed(wireRunId, error);
              chainPacer.flushAll();
              ingestLocalRunActivityEvent({ type: "RUN_FAILED", runId: wireRunId, error, failedAt: Date.now() });
            }
            answerPacer.flushAll();
            persistActivityChain();
            useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
              state: "error",
              error,
            });
            useWorkspaceStore
              .getState()
              .setConversationStatus(conversationId, "error");
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          // Client cancel: the run is honestly cancelled in the engine.
          // The answer stays EXACTLY as revealed — nothing received-but-hidden
          // is flushed in after the user stopped. Cancels stay blunt and
          // immediate — never gated on the chain close (9.2 hygiene).
          terminalFlushed = true;
          resetChainCloseGate();
          if (!sawWireRunStart) {
            const localRunId = createRunId();
            runStarted(localRunId, conversationId);
            wireRunId = localRunId;
            chainPacer.flushAll();
            ingestLocalRunActivityEvent({
              type: "RUN_STARTED",
              runId: localRunId,
              conversationId,
              startedAt: startedWallClock,
              mode: options?.mode ?? "agent",
            });
          }
          if (wireRunId) {
            runCancelled(wireRunId);
            chainPacer.flushAll();
            ingestLocalRunActivityEvent({ type: "RUN_CANCELLED", runId: wireRunId, cancelledAt: Date.now() });
          }
          answerPacer.dispose();
          persistActivityChain();
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            state: "stopped",
          });
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "stopped");
        } else {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The assistant service is unreachable right now.";
          // Unreachable service: the request may never have been read — no
          // activity is fabricated, and the run fails honestly. Failures
          // stay blunt and immediate — never gated on the chain close.
          terminalFlushed = true;
          resetChainCloseGate();
          if (!sawWireRunStart) {
            const localRunId = createRunId();
            runStarted(localRunId, conversationId);
            wireRunId = localRunId;
            chainPacer.flushAll();
            ingestLocalRunActivityEvent({
              type: "RUN_STARTED",
              runId: localRunId,
              conversationId,
              startedAt: startedWallClock,
              mode: options?.mode ?? "agent",
            });
          }
          if (wireRunId) {
            runFailed(wireRunId, message);
            chainPacer.flushAll();
            ingestLocalRunActivityEvent({ type: "RUN_FAILED", runId: wireRunId, error: message, failedAt: Date.now() });
          }
          answerPacer.flushAll();
          persistActivityChain();
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            state: "error",
            error: message,
          });
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "error");
        }
      } finally {
        generatingRef.current = false;
        if (activeController === controller) activeController = null;
        // runPhase describes in-flight work only; the message carries the state.
        useWorkspaceStore.getState().setRunPhase("idle");
        // Presentation pacers are per-run — stop their timers. The answer
        // pacer may still be DRAINING (word-by-word reveal in progress on the
        // success path) and the chain pacer may still hold the story tail;
        // the drain callbacks above flush + dispose both when finished.
        if (!chainPacer.isBusy()) chainPacer.dispose();
        // 9.2 (chain-close gate): the answer pacer may also still be WAITING
        // for the chain's full close — the reveal begins only AFTER the
        // 1.5s loader + one-shot close, which lands long after this finally.
        // Disposing here would silently drop the buffered real answer at the
        // close moment (push/syncFull become no-ops and the terminal drain
        // degenerates into an instant full-content write). Dispose only when
        // no gated reveal is still owed — a terminal (error/stop) path has
        // already reset the gate, so its reveal will never begin.
        if ((!revealWaitStarted || terminalFlushed) && !answerPacer.isDraining()) {
          answerPacer.dispose();
        }
      }
    },
    [],
  );

  const send = useCallback(
    (
      conversationId: string,
      content: string,
      attachments?: Attachment[],
      options?: AssistantSendOptions,
    ) => {
      const trimmed = typeof content === "string" ? content.trim() : "";
      if (
        !trimmed ||
        generatingRef.current ||
        activeController ||
        pendingRunStart
      ) {
        return;
      }

      /* Scroll on Message Send (user mandate, RULES.md §15): arm the gate
       * BEFORE the message enters the store so ConversationView's anchor
       * effect takes the controlled smooth scroll, and hold the run — the
       * thought chain starts ONLY after the view has arrived at the newly
       * pinned question (never while the scroll is still travelling). The
       * wait is safety-bounded inside waitForSendScrollArrival. */
      armSendScrollGate();
      pendingRunStart = true;

      const userMsgId = useWorkspaceStore
        .getState()
        .appendMessage(conversationId, {
          role: "user",
          content: trimmed,
          attachments:
            attachments && attachments.length > 0 ? attachments : undefined,
        });
      if (userMsgId === null) {
        // Nothing to anchor — stand the gate down, the run must not stall.
        releaseSendScrollGate();
        pendingRunStart = false;
        return;
      }

      // Re-read fresh state: appendMessage replaced the conversations array.
      const conversation = useWorkspaceStore
        .getState()
        .conversations.find((c) => c.id === conversationId);

      // Prior REAL messages (non-empty content), newest-window, + the new one.
      const prior = toPayloadMessages(
        (conversation?.messages ?? []).filter((m) => m.id !== userMsgId),
      );
      const history: ApiChatMessage[] = [
        ...prior,
        { role: "user", content: capContent(trimmed) },
      ];

      // Phase 8A typed wire attachments: only REAL repository files and real
      // selections go on the wire; labels without a resolvable path do not.
      // 8.5: image attachments travel as "session-file" (the backend states
      // the transport's image capability honestly to the model).
      const wireAttachments: ApiChatAttachment[] = (attachments ?? [])
        .filter(
          (a): a is Attachment =>
            a.kind === "image" ||
            ((a.kind === "file" || a.kind === "selection") &&
              typeof a.path === "string" &&
              a.path.trim().length > 0),
        )
        .map((a) =>
          a.kind === "image"
            ? ({ kind: "session-file", label: a.label, path: null } as ApiChatAttachment)
            : ({
                kind: a.kind === "file" ? ("repository-file" as const) : ("selection" as const),
                label: a.label,
                path: a.path,
              } as ApiChatAttachment),
        );

      // The run (chain + answer) begins only at scroll ARRIVAL — the wait
      // is bounded, so the view can never stall a real send.
      void waitForSendScrollArrival().then(() => {
        pendingRunStart = false;
        void runCompletion(conversationId, history, options, wireAttachments);
      });
    },
    [runCompletion],
  );

  /**
   * 8C question flow: deliver the user's answers to the paused run. The run
   * resumes ONLY after this succeeds — pause → ask → resume, never silently.
   * Agent Mode V2: on success the RESUME stream re-attaches to the same run
   * (full replay + live remainder) — the run never restarts.
   */
  const answerIntake = useCallback(
    async (
      conversationId: string,
      messageId: string,
      runId: string,
      answers: IntakeAnswer[],
    ): Promise<boolean> => {
      try {
        const res = await fetch("/api/assistant/runs/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, answers }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !data?.ok) {
          const error =
            typeof data?.error === "string" && data.error.trim().length > 0
              ? data.error
              : `Delivering answers failed (HTTP ${res.status}).`;
          useWorkspaceStore.getState().updateMessage(conversationId, messageId, {
            state: "error",
            error,
          });
          useWorkspaceStore.getState().setConversationStatus(conversationId, "error");
          runFailed(runId, error);
          ingestLocalRunActivityEvent({ type: "RUN_FAILED", runId, error, failedAt: Date.now() });
          return false;
        }
        // Delivered: the engine resumes, the message records the answers.
        resumeRunFromAwaiting();
        resumeRunActivity(runId);
        useWorkspaceStore.getState().updateMessage(conversationId, messageId, {
          intakeAnswers: answers,
        });
        // Agent Mode V2: re-attach to the SAME run — the resume stream
        // replays the history and delivers the live remainder.
        void runCompletion(conversationId, [], undefined, undefined, {
          runId,
          messageId,
        });
        return true;
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Could not reach the answers endpoint.";
        useWorkspaceStore.getState().updateMessage(conversationId, messageId, {
          state: "error",
          error: message,
        });
        useWorkspaceStore.getState().setConversationStatus(conversationId, "error");
        return false;
      }
    },
    [runCompletion],
  );

  /**
   * Agent Mode V2 (spec §3/§5/§51): the human decision on the approval card
   * INSIDE the thought chain. The decision is recorded on the message, the
   * Approval row is updated through the approvals route, and — only after
   * the server confirms — the SAME run resumes (apply → verify → validate
   * → critic → answer). "edited" only opens files; it never releases the
   * gate (the run stays paused until a real decision arrives).
   */
  const decideApproval = useCallback(
    async (
      conversationId: string,
      messageId: string,
      approvalId: string,
      decision: "approved" | "rejected",
      /** Paths the user removed on the approval card — applied server-side
       *  BEFORE the gate releases (the apply step never touches them). */
      excludePaths?: string[],
    ): Promise<void> => {
      useWorkspaceStore.getState().updateMessage(conversationId, messageId, {
        approvalDecision: decision,
      });
      try {
        const res = await fetch("/api/assistant/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            excludePaths && excludePaths.length > 0
              ? { approvalId, decision, excludePaths }
              : { approvalId, decision },
          ),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; success?: boolean; data?: { ok?: boolean; message?: string } }
          | null;
        // The route wraps success in the API envelope ({success, data}) —
        // accept both shapes honestly.
        const delivered =
          Boolean(data?.ok) || (Boolean(data?.success) && data?.data?.ok !== false);
        if (!res.ok || !delivered) {
          const error =
            typeof data?.error === "string" && data.error.trim().length > 0
              ? `Decision not delivered: ${data.error}`
              : `Delivering the decision failed (HTTP ${res.status}).`;
          useWorkspaceStore.getState().updateMessage(conversationId, messageId, {
            state: "error",
            error,
          });
          useWorkspaceStore.getState().setConversationStatus(conversationId, "error");
          return;
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Could not reach the approvals endpoint.";
        useWorkspaceStore.getState().updateMessage(conversationId, messageId, {
          state: "error",
          error: message,
        });
        useWorkspaceStore.getState().setConversationStatus(conversationId, "error");
        return;
      }
      // The gate is released server-side — resume the SAME run.
      const message = useWorkspaceStore
        .getState()
        .conversations.find((c) => c.id === conversationId)
        ?.messages.find((m) => m.id === messageId);
      const runId = message?.runId ?? pausedRun?.runId ?? null;
      if (!runId) return;
      void runCompletion(conversationId, [], undefined, undefined, {
        runId,
        messageId,
      });
    },
    [runCompletion],
  );

  /**
   * Regenerate keeps history honest: nothing is removed; a NEW assistant
   * placeholder is appended and the completion re-runs against the history up
   * to the last user message.
   */
  const regenerate = useCallback(() => {
    if (generatingRef.current || activeController || pendingRunStart) return;
    const conversation = selectActiveConversation(useWorkspaceStore.getState());
    if (!conversation || conversation.messages.length === 0) return;

    const last = conversation.messages[conversation.messages.length - 1];
    if (last.role !== "assistant") return;

    let lastUserIndex = -1;
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      if (conversation.messages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex === -1) return;

    const history = toPayloadMessages(
      conversation.messages.slice(0, lastUserIndex + 1),
    );
    if (history.length === 0) return;

    void runCompletion(conversation.id, history);
  }, [runCompletion]);

  return { send, stop, regenerate, answerIntake, decideApproval, isGenerating };
}
