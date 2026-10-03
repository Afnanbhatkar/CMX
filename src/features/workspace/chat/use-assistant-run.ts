"use client";

/**
 * CodeMind X V2 — assistant run hook (spec §18/§29).
 *
 * Drives the ACTIVE conversation's assistant completions against the real
 * single-shot POST /api/ai/chat endpoint. There is NO streaming endpoint, so
 * nothing here simulates one: the assistant message is appended empty, the
 * activity region shows two privacy-safe system steps (never chain-of-thought),
 * and the real response replaces the placeholder exactly once.
 *
 * Honesty rules (RULES.md §9):
 * - errors carry the backend's real error message (never a fake success),
 * - a stopped request is recorded as "stopped", never as an answer,
 * - `runPhase` describes in-flight work only and returns to "idle" on every
 *   terminal outcome (the message itself carries the per-message state).
 */

import { useCallback, useEffect, useRef } from "react";

import {
  selectActiveConversation,
  useWorkspaceStore,
} from "@/stores/workspace-store";
import type {
  Attachment,
  ChatActivityStep,
} from "@/features/workspace/types";
import {
  createRunId,
  exposeAssistantTooling,
  runActivityCompleted,
  runActivityStarted,
  runCancelled,
  runCompleted,
  runFailed,
  runStarted,
} from "../assistant";

/* Verification tooling (window.__cmxAssistant, read-only observation). */
exposeAssistantTooling();

/** Wire format of POST /api/ai/chat (1..30 messages, each ≤ 8000 chars). */
interface ApiChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ApiChatResponse {
  ok?: boolean;
  content?: string;
  error?: string;
}

/** Prior-context window sent to the API (backend also caps at 30 messages). */
const MAX_PAYLOAD_MESSAGES = 20;
/** Hard transport cap per message, mirroring the backend schema (8000 chars). */
const MAX_PAYLOAD_CHARS = 8_000;

/* ------------------------------------------------------------------ */
/* Privacy-safe activity steps (no chain-of-thought, ever)             */
/* ------------------------------------------------------------------ */

function activeSteps(): ChatActivityStep[] {
  return [
    { id: "a1", kind: "understanding", label: "Reading your request", status: "active" },
    { id: "a2", kind: "finalize", label: "Composing response", status: "pending" },
  ];
}

function doneSteps(): ChatActivityStep[] {
  return [
    { id: "a1", kind: "understanding", label: "Reading your request", status: "done" },
    { id: "a2", kind: "finalize", label: "Composing response", status: "done" },
  ];
}

/**
 * Honest failure steps: a1 genuinely finished reading the request; a2 did NOT
 * fail at "composing" (nothing was composed) — it stays pending and the real
 * error text lives on the message, not in the activity chain.
 */
function failedSteps(): ChatActivityStep[] {
  return [
    { id: "a1", kind: "understanding", label: "Reading your request", status: "done" },
    { id: "a2", kind: "finalize", label: "Composing response", status: "pending" },
  ];
}

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
  send: (conversationId: string, content: string, attachments?: Attachment[]) => void;
  stop: () => void;
  regenerate: () => void;
  isGenerating: boolean;
}

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

  /**
   * Shared completion pipeline: appends the assistant placeholder, runs the
   * real request, and records the honest terminal state.
   * `history` is the exact wire payload (already capped/filtered).
   */
  const runCompletion = useCallback(
    async (conversationId: string, history: ApiChatMessage[]) => {
      if (generatingRef.current || activeController) return;

      const store = useWorkspaceStore.getState();
      const assistantMsgId = store.appendMessage(conversationId, {
        role: "assistant",
        content: "",
      });
      if (assistantMsgId === null) return;

      store.updateMessage(conversationId, assistantMsgId, {
        activity: activeSteps(),
      });
      store.setConversationStatus(conversationId, "generating");
      store.setRunPhase("thinking");

      generatingRef.current = true;
      const controller = new AbortController();
      activeController = controller;

      const activeFile = useWorkspaceStore.getState().activeTabPath ?? undefined;

      /* Phase 8 plumbing: report the run through the ActivityEngine. Both
         steps are genuinely in-flight during the single backend call —
         reading the request and composing the response — so both start now
         and complete only when the response proves it. */
      const runId = createRunId();
      runStarted(runId, conversationId);
      runActivityStarted(runId, {
        id: "understand",
        kind: "steps",
        title: "Reading your request",
        summary: null,
        metadata: null,
        children: [],
      });
      runActivityStarted(runId, {
        id: "compose",
        kind: "steps",
        title: "Composing response",
        summary: null,
        metadata: null,
        children: [],
      });

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            context: activeFile ? { activeFile } : undefined,
          }),
          signal: controller.signal,
        });

        const data = (await res.json().catch(() => null)) as ApiChatResponse | null;
        const content =
          typeof data?.content === "string" ? data.content : "";

        if (res.ok && data?.ok === true && content.trim().length > 0) {
          runActivityCompleted(runId, "understand", "Request read");
          runActivityCompleted(runId, "compose", "Response composed");
          runCompleted(runId);
          useWorkspaceStore.getState().updateMessage(
            conversationId,
            assistantMsgId,
            {
              content,
              state: "complete",
              activity: doneSteps(),
            },
          );
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "completed");
        } else {
          const error =
            typeof data?.error === "string" && data.error.trim().length > 0
              ? data.error
              : `The assistant request failed (HTTP ${res.status}).`;
          // The request was read (the backend answered with an error);
          // whether composition happened is unknowable, so "compose" stays
          // active inside a failed run — honest, not decorated.
          runActivityCompleted(runId, "understand", "Request read");
          runFailed(runId, error);
          useWorkspaceStore.getState().updateMessage(
            conversationId,
            assistantMsgId,
            {
              state: "error",
              error,
              activity: failedSteps(),
            },
          );
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "error");
        }
      } catch (error) {
        if (isAbortError(error)) {
          runCancelled(runId);
          useWorkspaceStore.getState().updateMessage(
            conversationId,
            assistantMsgId,
            { state: "stopped" },
          );
          useWorkspaceStore
            .getState()
            .setConversationStatus(conversationId, "stopped");
        } else {
          // Unreachable service: the request may never have been read — no
          // activity is marked complete, and the run fails honestly.
          runFailed(runId, "The assistant service is unreachable right now.");
          useWorkspaceStore.getState().updateMessage(
            conversationId,
            assistantMsgId,
            {
              state: "error",
              error: "The assistant service is unreachable right now.",
              activity: failedSteps(),
            },
          );
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
    [],
  );

  const send = useCallback(
    (conversationId: string, content: string, attachments?: Attachment[]) => {
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

      void runCompletion(conversationId, history);
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
