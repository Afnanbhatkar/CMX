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
import type { ComposerMode, SequencedAssistantEvent } from "../assistant/contracts";
import {
  applyWireEvent,
  assistantActivityEngine,
  buildRunSteps,
  createRunId,
  exposeAssistantTooling,
  noteTransportSeq,
  recordFirstEventLatency,
  runCancelled,
  runFailed,
  runStarted,
} from "../assistant";
import type {
  Attachment,
  ChatActivityStep,
} from "@/features/workspace/types";

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

export interface AssistantSendOptions {
  mode: ComposerMode;
  /** Requested gateway model id; null = gateway default. */
  model: string | null;
  context: AssistantSendContext;
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

export interface AssistantRun {
  send: (
    conversationId: string,
    content: string,
    attachments?: Attachment[],
    options?: AssistantSendOptions,
  ) => void;
  stop: () => void;
  regenerate: () => void;
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
    activeController?.abort();
  }, []);

  /* Unmount cleanup: abort any in-flight completion this surface started. */
  useEffect(() => {
    return () => {
      activeController?.abort();
    };
  }, []);

  /** Mirror the engine snapshot onto the in-flight message's activity chain. */
  const syncActivityFromEngine = useCallback(
    (conversationId: string, assistantMsgId: string) => {
      const snapshot = assistantActivityEngine.getSnapshot();
      const steps: ChatActivityStep[] = buildRunSteps(snapshot);
      useWorkspaceStore
        .getState()
        .updateMessage(conversationId, assistantMsgId, { activity: steps });
    },
    [],
  );

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
    ) => {
      if (generatingRef.current || activeController) return;

      const store = useWorkspaceStore.getState();
      const assistantMsgId = store.appendMessage(conversationId, {
        role: "assistant",
        content: "",
      });
      if (assistantMsgId === null) return;

      const startedWallClock = Date.now();
      const t0 = performance.now();

      store.updateMessage(conversationId, assistantMsgId, {
        activity: [],
      });
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

      let wireRunId: string | null = null;
      let sawWireRunStart = false;
      let firstEventRecorded = false;
      let resultFrame: RunResultFrame | null = null;

      /** Apply one sequenced wire event; keep the message chain in sync. */
      const handleWireEvent = (event: SequencedAssistantEvent): void => {
        if (event.type === "RUN_STARTED") {
          sawWireRunStart = true;
          wireRunId = event.runId;
        }
        // Engine first: RUN_STARTED resets the run metrics; the measured
        // latency is recorded against the NEW run right after.
        applyWireEvent(event);
        if (!firstEventRecorded) {
          firstEventRecorded = true;
          if (wireRunId) recordFirstEventLatency(wireRunId, performance.now() - t0);
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            firstEventMs: Math.round(performance.now() - t0),
          });
        }
        syncActivityFromEngine(conversationId, assistantMsgId);
      };

      try {
        const res = await fetch("/api/assistant/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            mode: options?.mode,
            model: options?.model ?? undefined,
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
                }
              : undefined,
          }),
          signal: controller.signal,
        });

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
                // One honest chunk: the complete answer, exactly once.
                useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
                  content: frame.frame.content,
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
            if (frame.kind === "event" && frame.event.type === "RUN_COMPLETED") {
              break stream;
            }
          }
        }

        if (errorMessage !== null) {
          // The engine already applied RUN_FAILED from the wire; mirror the
          // terminal state on the message with the backend's real error.
          useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
            state: "error",
            error: errorMessage,
          });
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "error");
        } else {
          const snapshot = assistantActivityEngine.getSnapshot();
          const completedOk =
            resultFrame !== null &&
            resultFrame.content.trim().length > 0 &&
            snapshot.status === "completed";
          if (completedOk) {
            useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
              state: "complete",
              thoughtForMs: snapshot.durationMs,
            });
            useWorkspaceStore
              .getState()
              .setConversationStatus(conversationId, "completed");
          } else if (resultFrame !== null && resultFrame.content.trim().length > 0) {
            // Content arrived but the stream ended without RUN_COMPLETED —
            // finish honestly from the measured facts we DO have.
            useWorkspaceStore.getState().updateMessage(conversationId, assistantMsgId, {
              state: "complete",
              thoughtForMs: Date.now() - startedWallClock,
            });
            useWorkspaceStore
              .getState()
              .setConversationStatus(conversationId, "completed");
          } else {
            const error =
              "The assistant returned an empty response.";
            if (!sawWireRunStart) {
              const localRunId = createRunId();
              runStarted(localRunId, conversationId);
              wireRunId = localRunId;
            }
            if (wireRunId) runFailed(wireRunId, error);
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
          if (!sawWireRunStart) {
            const localRunId = createRunId();
            runStarted(localRunId, conversationId);
            wireRunId = localRunId;
          }
          if (wireRunId) runCancelled(wireRunId);
          syncActivityFromEngine(conversationId, assistantMsgId);
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
          // activity is fabricated, and the run fails honestly.
          if (!sawWireRunStart) {
            const localRunId = createRunId();
            runStarted(localRunId, conversationId);
            wireRunId = localRunId;
          }
          if (wireRunId) runFailed(wireRunId, message);
          syncActivityFromEngine(conversationId, assistantMsgId);
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
      }
    },
    [syncActivityFromEngine],
  );

  const send = useCallback(
    (
      conversationId: string,
      content: string,
      attachments?: Attachment[],
      options?: AssistantSendOptions,
    ) => {
      const trimmed = typeof content === "string" ? content.trim() : "";
      if (!trimmed || generatingRef.current || activeController) return;

      const userMsgId = useWorkspaceStore
        .getState()
        .appendMessage(conversationId, {
          role: "user",
          content: trimmed,
          attachments:
            attachments && attachments.length > 0 ? attachments : undefined,
        });
      if (userMsgId === null) return;

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
      const wireAttachments: ApiChatAttachment[] = (attachments ?? [])
        .filter(
          (a): a is Attachment & { path: string } =>
            (a.kind === "file" || a.kind === "selection") &&
            typeof a.path === "string" &&
            a.path.trim().length > 0,
        )
        .map((a) => ({
          kind: a.kind === "file" ? ("repository-file" as const) : ("selection" as const),
          label: a.label,
          path: a.path,
        }));

      void runCompletion(conversationId, history, options, wireAttachments);
    },
    [runCompletion],
  );

  /**
   * Regenerate keeps history honest: nothing is removed; a NEW assistant
   * placeholder is appended and the completion re-runs against the history up
   * to the last user message.
   */
  const regenerate = useCallback(() => {
    if (generatingRef.current || activeController) return;
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

  return { send, stop, regenerate, isGenerating };
}
