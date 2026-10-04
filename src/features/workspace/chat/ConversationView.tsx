"use client";

/**
 * CodeMind X V2 — conversation view (messages + activity + approval slot).
 *
 * Renders the ACTIVE conversation's real messages only: real timestamps,
 * real per-message states, privacy-safe activity chains (ThoughtChain) and
 * the assistant's actual markdown answer. No simulated streaming — a
 * generating message shows an honest "Composing response…" loader until the
 * real response arrives, fails, or is stopped.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import { Check, Copy, FileCode2, Paperclip, RotateCcw } from "lucide-react";

import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Attachment, ChatMessage } from "@/features/workspace/types";
import { selectLedger, useContextInspectorStore } from "@/stores/context-inspector-store";
import { FileReferenceChip } from "@/features/workspace/components/FileReferenceChip";
import { ApprovalCard } from "@/components/ai";
import {
  ActivityChain,
  ActivityChainLive,
} from "@/components/ai-activity/ActivityChain";
import { useRunActivity } from "@/features/workspace/chat/activity/use-run-activity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAssistantRun } from "./use-assistant-run";
import { ApprovalCardSlot } from "./ApprovalCardSlot";
import { ChatMarkdown } from "./ChatMarkdown";
import { MemoryUsedChip } from "./MemoryUsedChip";
import { QuestionFlow } from "./QuestionFlow";

export interface ConversationViewProps {
  conversationId: string;
}

const COPY_RESET_MS = 1_600;

/** Real HH:mm from the message timestamp; honest fallback for invalid data. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm");
}

/* ------------------------------------------------------------------ */
/* Copy button (Copy → Check swap, 1.6s)                               */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    try {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
        })
        .catch(() => {
          // clipboard unavailable — state stays honest
        });
    } catch {
      // clipboard API not present in this context
    }
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={copied ? "Copied" : "Copy message"}
          onClick={copy}
          className="size-6 rounded-[4px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5 text-success" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy message"}</TooltipContent>
    </Tooltip>
  );
}

function RegenerateButton({
  disabled,
  onRegenerate,
}: {
  disabled?: boolean;
  onRegenerate: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Regenerate response"
          disabled={disabled}
          onClick={onRegenerate}
          className="h-6 gap-1 rounded-[4px] px-1.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <RotateCcw aria-hidden="true" className="size-3" />
          Regenerate
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {disabled ? "A response is being generated" : "Regenerate response"}
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  if (!attachment.path) {
    return (
      <span className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border-subtle bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
        <Paperclip aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate font-mono">{attachment.label}</span>
      </span>
    );
  }

  // V2.1 §B — chat file references use the ONE shared FileReferenceChip
  // (editor navigation routing + consistent file-state presentation).
  return <FileReferenceChip path={attachment.path} source="chat" size="sm" />;
}

/* ------------------------------------------------------------------ */
/* Live run activity (Phase 8D — real-time activity chain)             */
/* ------------------------------------------------------------------ */

/**
 * The current run's real-time activity chain, driven by the per-run store
 * over the SAME backend events as before. While the run is PAUSED for
 * intake questions (8C), the QuestionFlow card renders below the chain —
 * the run resumes only after the user answers.
 */
function RunActivityLive({
  message,
  conversationId,
}: {
  message: ChatMessage;
  conversationId: string;
}) {
  const runId = message.runId ?? null;
  const snapshot = useRunActivity(runId);
  const { answerIntake } = useAssistantRun();
  const [submitting, setSubmitting] = useState(false);

  const paused =
    snapshot.status === "waiting" &&
    snapshot.waitingKind === "question" &&
    message.questionBatch !== null &&
    message.questionBatch !== undefined;

  const handleAnswer = async (answers: Parameters<typeof answerIntake>[3]) => {
    if (!runId) return;
    setSubmitting(true);
    try {
      await answerIntake(conversationId, message.id, runId, answers);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-2 space-y-2" data-testid="run-activity-live">
      <ActivityChainLive runId={runId} />
      {paused && message.questionBatch ? (
        <QuestionFlow
          batch={message.questionBatch}
          answers={message.intakeAnswers ?? []}
          onAnswer={(answers) => void handleAnswer(answers)}
          submitting={submitting}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex min-w-0 justify-end">
      <div className="max-w-[85%] min-w-0 rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
        <div className="mb-1 flex items-center justify-end gap-2">
          <time dateTime={message.createdAt} className="text-[10px] text-muted-foreground/70">
            {formatTime(message.createdAt)}
          </time>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            You
          </span>
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1">
            {message.attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  conversationId,
  isLast,
  isGenerating,
  onRegenerate,
}: {
  message: ChatMessage;
  conversationId: string;
  isLast: boolean;
  isGenerating: boolean;
  onRegenerate: () => void;
}) {
  const busy = message.state === "generating";
  const updateMessage = useWorkspaceStore((s) => s.updateMessage);
  const disabledMemoryIds = useContextInspectorStore((s) =>
    selectLedger(s, conversationId).disabledMemoryIds,
  );
  const disableMemory = useContextInspectorStore((s) => s.disableMemory);
  const enableMemory = useContextInspectorStore((s) => s.enableMemory);

  const recordApprovalDecision = (decision: "approved" | "rejected" | "edited") => {
    if (!message.approval) return;
    updateMessage(conversationId, message.id, { approvalDecision: decision });
  };

  return (
    <div className="max-w-[92%] min-w-0">
      {/* Phase 8D: the real-time activity chain IS the message header — the
          old "Assistant" heading/status presentation is intentionally gone. */}

      {/* Phase 8D live run: per-run chain (Thinking → Solving → Waiting →
          final duration) + the 8C question flow while paused. */}
      {busy && (
        <RunActivityLive message={message} conversationId={conversationId} />
      )}

      {/* Persisted chain for history (reload keeps the final timeline);
          legacy pre-8D messages render through the same presentation. */}
      {!busy && (
        <ActivityChain
          chain={message.activityChain ?? null}
          legacySteps={message.activity}
          legacyThoughtForMs={message.thoughtForMs ?? null}
          legacyRunId={message.runId ?? null}
        />
      )}

      {message.state === "complete" && <ChatMarkdown content={message.content} />}

      {/* Phase 8C: the model's proposed change awaits an explicit human
          decision — recorded locally, never applied (no ChangeSet yet). */}
      {!busy && message.approval && (
        <ApprovalCard
          approval={message.approval}
          decision={message.approvalDecision ?? null}
          onDecision={recordApprovalDecision}
        />
      )}

      {message.state === "error" && (
        <div className="space-y-1.5">
          <Alert variant="destructive" className="py-2">
            <AlertTitle className="text-[12px] font-medium">The assistant run failed</AlertTitle>
            <AlertDescription className="text-[12px] leading-relaxed">
              {message.error ?? "The assistant request failed."}
            </AlertDescription>
          </Alert>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRegenerate}
            disabled={isGenerating}
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <RotateCcw aria-hidden="true" className="size-3" />
            Retry
          </Button>
        </div>
      )}

      {message.state === "stopped" && (
        <div className="space-y-1.5">
          <p className="text-[13px] text-muted-foreground">Generation stopped.</p>
          <RegenerateButton disabled={isGenerating} onRegenerate={onRegenerate} />
        </div>
      )}

      {message.state === "complete" && (
        <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
          <CopyButton text={message.content} />
          {isLast && (
            <RegenerateButton disabled={isGenerating} onRegenerate={onRegenerate} />
          )}
          {typeof message.firstEventMs === "number" ? (
            <span
              className="rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/80"
              title="Measured latency to the first visible activity event"
            >
              first event {message.firstEventMs}ms
            </span>
          ) : null}
          {/* Phase 8A run meta — measured truth only (mode issued, model the
              gateway actually served). Rendered only when present. */}
          {message.mode ? (
            <span
              className="rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/80"
              title={`Run mode: ${message.mode}`}
            >
              {message.mode}
            </span>
          ) : null}
          {message.servedModel ? (
            <span
              className="rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/80"
              title={`Model served by the LLM Gateway: ${message.servedModel}`}
            >
              {message.servedModel}
            </span>
          ) : null}
          {/* Phase 8C: memory reveal — what the run actually used. */}
          {(message.memories?.length ?? 0) > 0 || message.memoryNote ? (
            <MemoryUsedChip
              memories={message.memories ?? []}
              note={message.memoryNote ?? null}
              disabledIds={disabledMemoryIds}
              onToggle={(memoryId, enabled) =>
                enabled
                  ? enableMemory(conversationId, memoryId)
                  : disableMemory(conversationId, memoryId)
              }
            />
          ) : null}
        </div>
      )}

      {/* Phase 2 contract slot: renders null until real approvals exist. */}
      <ApprovalCardSlot />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation view                                                   */
/* ------------------------------------------------------------------ */

/** Distance (px) from the bottom inside which auto-follow stays active. */
const NEAR_BOTTOM_PX = 140;
/** Padding above a message when it is anchored to the viewport top. */
const ANCHOR_PAD_PX = 8;
/** Breathing room added under a just-anchored question while generating. */
const ANCHOR_SPACER_BUFFER_PX = 32;
/** How far the user may drift from the anchor before it is left alone. */
const WANDER_TOLERANCE_PX = 600;

/**
 * Native scroll host (deliberately NOT Radix ScrollArea): the Radix
 * viewport wraps content in a `display: table` sizing element which makes
 * long chat content size to max-content — text/code stopped wrapping and
 * nested scrollable regions (the activity chain's 40vh timeline) broke.
 * A plain overflow host keeps wrapping native and lets the chain's own
 * scroller capture the wheel first, chaining to the chat only at its ends.
 *
 * Scroll choreography (ChatGPT/Claude-style):
 * - sending a message anchors THAT user message to the TOP of the
 *   viewport — the question is the first thing visible, older chat has
 *   scrolled up out of view;
 * - while content grows, the view auto-follows the bottom ONLY when the
 *   user is already near the bottom (never fights an anchored view);
 * - switching conversations opens at the bottom, instantly.
 */
export function ConversationView({ conversationId }: ConversationViewProps) {
  const conversation = useWorkspaceStore(
    (s) => s.conversations.find((c) => c.id === conversationId) ?? null,
  );
  const { regenerate, isGenerating } = useAssistantRun();
  const prefersReduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  /** Count already attributed to the current conversation (no anchors for history). */
  const prevCountRef = useRef<number | null>(null);
  /** Set by the switch effect; consumed by the anchor effect (same commit). */
  const resetAnchorContextRef = useRef(false);
  /** Last anchor target — the re-anchor point when the spacer collapses. */
  const lastAnchorTargetRef = useRef<number | null>(null);
  /**
   * Generation spacer: extra scrollable room BELOW the newest message so a
   * just-sent question can anchor at the TOP of the viewport even though
   * the response has not grown yet (the ChatGPT/Claude behavior). Removed
   * (with scroll compensation) when the run reaches a terminal state.
   */
  const [anchorSpacer, setAnchorSpacer] = useState(0);
  /** Previous spacer height — owned EXCLUSIVELY by the spacer layout effect. */
  const prevSpacerRef = useRef(0);
  const pendingAnchorTargetRef = useRef<number | null>(null);

  const messages = conversation?.messages ?? [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  /** Keep the near-bottom flag true only while the user really is there. */
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  /**
   * Render-phase adjustment (the sanctioned "derive state from changing
   * inputs" pattern — STATE only; refs are never touched during render):
   * when the conversation switches or the run reaches a terminal state,
   * the generation spacer resets HERE so React re-renders once with
   * consistent values. The ref-based context resets happen in the effects
   * below.
   */
  const runIsTerminal =
    lastMessage?.state === "complete" ||
    lastMessage?.state === "error" ||
    lastMessage?.state === "stopped";
  const [spacerGate, setSpacerGate] = useState({
    conversationId,
    terminal: runIsTerminal,
  });
  const [switchSeq, setSwitchSeq] = useState(0);
  if (
    spacerGate.conversationId !== conversationId ||
    spacerGate.terminal !== runIsTerminal
  ) {
    const switched = spacerGate.conversationId !== conversationId;
    setSpacerGate({ conversationId, terminal: runIsTerminal });
    if (switched) setSwitchSeq((seq) => seq + 1);
    if (switched || runIsTerminal) {
      if (anchorSpacer !== 0) setAnchorSpacer(0);
    }
  }

  /** Terminal run → no pending anchor may survive into the next run. */
  useEffect(() => {
    if (!runIsTerminal) return;
    pendingAnchorTargetRef.current = null;
  }, [runIsTerminal]);

  /**
   * Conversation switch → reset the anchor context + jump to the bottom.
   * DOM/ref work only; the anchor effect consumes the context reset flag
   * in this same commit (declared after this effect).
   */
  useEffect(() => {
    if (switchSeq === 0) return; // mount — history opens via auto-follow
    nearBottomRef.current = true;
    resetAnchorContextRef.current = true;
    lastAnchorTargetRef.current = null;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [switchSeq]);

  /**
   * New user message (appended AFTER mount) → anchor it to the top of the
   * viewport. When the document is too short to scroll that far, a
   * generation spacer is reserved below so the anchor lands exactly; the
   * spacer collapses (scroll-compensated) once the run finishes. History
   * on mount/conversation-switch never anchors.
   */
  useEffect(() => {
    const previous = prevCountRef.current;
    prevCountRef.current = messages.length;
    // A conversation switch landed in this commit: rebase the anchor
    // boundary on the new conversation's history — never anchor it.
    if (resetAnchorContextRef.current) {
      resetAnchorContextRef.current = false;
      return;
    }
    if (previous === null || messages.length <= previous) return;
    const added = messages.slice(previous);
    const newUserMessage = added.find((m) => m.role === "user");
    if (!newUserMessage) return;
    const scroller = scrollerRef.current;
    const element = scroller?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(newUserMessage.id)}"]`,
    );
    if (!scroller || !element) return;
    nearBottomRef.current = false;
    const target = Math.max(0, element.offsetTop - ANCHOR_PAD_PX);
    lastAnchorTargetRef.current = target;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (target <= maxScroll) {
      // Enough room below already — anchor directly, no spacer needed.
      pendingAnchorTargetRef.current = null;
      scroller.scrollTo({
        top: target,
        behavior: prefersReduced ? "auto" : "smooth",
      });
      return;
    }
    // Reserve the missing room, then anchor once it exists (layout effect).
    pendingAnchorTargetRef.current = target;
    setAnchorSpacer(target - maxScroll + ANCHOR_SPACER_BUFFER_PX);
  }, [messages, prefersReduced]);

  /**
   * Spacer transitions — ONE owner: on growth it performs the pending
   * anchor (pre-paint, no flicker); on shrink (run finished — the answer
   * now occupies the reserved room) it RE-ANCHORS the question instead of
   * letting the browser clamp-jump the view downward. If the user has
   * scrolled far away from the anchor, their position is respected.
   */
  useLayoutEffect(() => {
    const previous = prevSpacerRef.current;
    prevSpacerRef.current = anchorSpacer;
    const el = scrollerRef.current;
    if (!el) return;
    if (anchorSpacer < previous) {
      const desired = lastAnchorTargetRef.current;
      const wandered = desired === null || el.scrollTop < desired - WANDER_TOLERANCE_PX;
      if (!wandered) {
        el.scrollTop = Math.min(desired, el.scrollHeight - el.clientHeight);
      }
    }
    const target = pendingAnchorTargetRef.current;
    if (target === null) return;
    pendingAnchorTargetRef.current = null;
    el.scrollTo({
      top: target,
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, [anchorSpacer, prefersReduced]);

  /**
   * Auto-follow the newest content — only when the user is near the bottom.
   * At a TERMINAL state this effect stands down: the final viewport position
   * belongs to the spacer collapse re-anchor (the layout effect above), so
   * the two never fight over the scroll position.
   */
  useEffect(() => {
    if (runIsTerminal) return;
    if (!nearBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, [messages.length, lastMessage?.state, lastMessage?.content, runIsTerminal, prefersReduced]);

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      data-testid="chat-scroll-host"
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-color:var(--border-subtle)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-subtle [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5"
    >
      <div className="relative w-full min-w-0 space-y-4 p-3" aria-live="polite">
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={message.id} data-message-id={message.id} className="min-w-0">
              <UserMessage message={message} />
            </div>
          ) : (
            <div key={message.id} data-message-id={message.id} className="min-w-0">
              <AssistantMessage
                message={message}
                conversationId={conversationId}
                isLast={index === messages.length - 1}
                isGenerating={isGenerating}
                onRegenerate={regenerate}
              />
            </div>
          ),
        )}
        {messages.length === 0 && (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            No messages yet — ask something to start this conversation.
          </p>
        )}
        <div aria-hidden="true" style={{ height: anchorSpacer }} />
      </div>
    </div>
  );
}
