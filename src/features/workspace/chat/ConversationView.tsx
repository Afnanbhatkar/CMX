"use client";

/**
 * CodeMind X V2 — conversation view (messages + activity + approval slot).
 *
 * Renders the ACTIVE conversation's real messages only: real timestamps,
 * real per-message states, privacy-safe activity chains and the assistant's
 * actual markdown answer. The answer streams word by word (Phase 9) from
 * REAL gateway token deltas — received content is revealed smoothly, never
 * invented; a generating message with no content yet shows the live
 * activity chain until the first token arrives.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import { Check, Copy, FileCode2, Paperclip, RotateCcw } from "lucide-react";

import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Attachment, ChatMessage } from "@/features/workspace/types";
import { selectLedger, useContextInspectorStore } from "@/stores/context-inspector-store";
import { FileReferenceChip } from "@/features/workspace/components/FileReferenceChip";
import { ChangeResultCard } from "./ChangeResultCard";
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
import { releaseSendScrollGate } from "./activity/send-scroll-gate";
import { ApprovalCardSlot } from "./ApprovalCardSlot";
import { ChatMarkdown } from "./ChatMarkdown";
import { ResponseView } from "./ResponseView";
import { MemoryUsedChip } from "./MemoryUsedChip";
import { isCasualPrompt } from "@/lib/casual-prompt";

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
 * over the SAME backend events as before. Agent Mode V2 (spec §3): the
 * approval card renders INSIDE the chain — the decision releases the real
 * engine gate. The question flow moved ABOVE the composer (spec §76).
 */
function RunActivityLive({
  message,
  conversationId,
  minimal,
}: {
  message: ChatMessage;
  conversationId: string;
  minimal: boolean;
}) {
  const runId = message.runId ?? null;
  useRunActivity(runId);
  const { decideApproval } = useAssistantRun();

  return (
    <div className="mb-2 space-y-2" data-testid="run-activity-live">
      <ActivityChainLive
        runId={runId}
        minimal={minimal}
        approval={message.approval ?? null}
        approvalDecision={message.approvalDecision ?? null}
        onApprovalDecision={(decision) => {
          if (!message.approval) return;
          void decideApproval(
            conversationId,
            message.id,
            message.approval.id,
            decision,
          );
        }}
      />
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
  triggerPrompt,
}: {
  message: ChatMessage;
  conversationId: string;
  isLast: boolean;
  isGenerating: boolean;
  onRegenerate: () => void;
  /** The user text that started THIS run — decides the casual-prompt
   * presentation (chain collapsed, Thinking chip only). */
  triggerPrompt: string;
}) {
  const busy = message.state === "generating";
  const waiting = message.state === "waiting";
  const disabledMemoryIds = useContextInspectorStore((s) =>
    selectLedger(s, conversationId).disabledMemoryIds,
  );
  const disableMemory = useContextInspectorStore((s) => s.disableMemory);
  const enableMemory = useContextInspectorStore((s) => s.enableMemory);

  /* Phase 9.6 fix (approval mid-run pause invisible): under the pin-to-top
   * anchor contract (RULES.md §15) the auto-follower stands down while the
   * chain grows, so the orchestrator's approval card — rendered INSIDE the
   * thought chain (Agent Mode V2, spec §3) — can land BELOW THE FOLD. The
   * multi-agent run genuinely pauses at the approval gate until a human
   * decides, so an unseen card reads as "the run is stuck". When a NEW
   * approval arrives on a run, bring the card into view ONCE (smooth,
   * minimal scroll). A one-shot user-action scroll — the user's own scroll
   * always wins afterwards. */
  const approvalCardRef = useRef<HTMLDivElement | null>(null);
  const scrolledApprovalIdRef = useRef<string | null>(null);
  const approvalId = message.approval?.id ?? null;
  useEffect(() => {
    if (busy || waiting) {
      if (!approvalId) return;
      if (scrolledApprovalIdRef.current === approvalId) return;
      scrolledApprovalIdRef.current = approvalId;
      approvalCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [busy, waiting, approvalId]);

  /* Agent Mode V2 (spec §3): the decision goes through the hook — it posts
   * to /api/assistant/approvals and resumes the SAME run through the
   * resume stream. The card itself renders inside the chain; this wrapper
   * anchor just keeps the one-shot scroll working. */
  const { decideApproval } = useAssistantRun();

  const approvalAnchor = message.approval ? (
    <div ref={approvalCardRef} aria-hidden="true" className="h-0" />
  ) : null;

  return (
    <div className="max-w-[92%] min-w-0">
      {/* Phase 8D: the real-time activity chain IS the message header — the
          old "Assistant" heading/status presentation is intentionally gone.

          LIVE (generating) vs WAITING (Agent Mode V2): a run paused at the
          approval gate / intake questions renders through the SAME chain
          surface — the chain is genuinely unresolved, so it must stay open
          with the approval card (or the composer question) interactive.
          spec §31/§74: no auto-collapse, no final label, no answer. */}
      {/* LIVE chain while the run streams. A WAITING (paused) run renders
          through the PERSISTED chain below — the paused snapshot was
          captured at the pause and restores as open + waiting (spec §110),
          so both the live-pause and the reload cases show the same truth. */}
      {busy && (
        <RunActivityLive
          message={message}
          conversationId={conversationId}
          minimal={isCasualPrompt(triggerPrompt)}
        />
      )}

      {/* Persisted chain for history (reload keeps the final timeline);
          legacy pre-8D messages render through the same presentation.
          Agent Mode V2: a WAITING message restores its paused chain here
          (snapshotFromPersistedChain keeps it open) with the approval card
          still interactive — the run is genuinely unresolved (spec §73). */}
      {!busy && (
        <ActivityChain
          chain={message.activityChain ?? null}
          legacySteps={message.activity}
          legacyThoughtForMs={message.thoughtForMs ?? null}
          legacyRunId={message.runId ?? null}
          approval={message.approval ?? null}
          approvalDecision={message.approvalDecision ?? null}
          onApprovalDecision={(decision) => {
            if (!message.approval) return;
            void decideApproval(conversationId, message.id, message.approval.id, decision);
          }}
        />
      )}
      {waiting && message.approval && (
        <div className="sr-only">
          Approval requested — use the controls in the activity chain above.
        </div>
      )}

      {/* Phase 9: the answer streams word by word below the live chain
          (revealed REAL gateway deltas). The chain closes into its final
          duration chip when the first token arrives, exactly like the
          prototype; history and stopped runs keep their real content.
          Phase 8.5: once the typed structured payload arrives, the message
          renders through the ResponseView — verified references, uncertainty
          badges and template sections around the SAME body. */}
      {message.content.trim().length > 0 &&
      (busy || message.state === "complete" || message.state === "stopped") ? (
        message.structured && !busy ? (
          <ResponseView structured={message.structured} content={message.content} />
        ) : (
          <ChatMarkdown content={message.content} />
        )
      ) : null}

      {/* Agent Mode V2 (spec §21/§22): the machine-generated change result
          card — real files, real verification, real diffs. Rendered in the
          CHAT (result surface) once the run completes; approval lives in
          the THOUGHT CHAIN, never here. */}
      {!busy && !waiting && message.changeResult ? (
        <ChangeResultCard result={message.changeResult} />
      ) : null}

      {/* Agent Mode V2: the approval card is NOT a chat message anymore —
          it lives inside the thought chain (spec §3/§6). This zero-height
          anchor only supports the one-shot scroll-into-view. */}
      {approvalAnchor}

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
              className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] text-muted-foreground"
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

/* ───────────────────────────────────────────────────────────────────
 * PROTECTED FEATURE — DO NOT REMOVE, DISABLE, OR ALTER (user mandate,
 * RULES.md §15): "Pin User Message to Top / Scrolling Anchoring".
 * On send, the new user message MUST anchor to the TOP of the viewport
 * (offsetTop − 8px) and the view MUST hold that position (anchor-hold)
 * while the answer grows below it. The generation spacer, the silent
 * spacer collapse, the conversation-switch rebase and the auto-follower
 * stand-down are all part of this contract. Message wrappers MUST keep
 * REAL layout — no content-visibility / contain-intrinsic-size /
 * virtualization that reports placeholder heights (Phase 8.5's perf
 * tweak did exactly that, silently corrupting the anchor math in long
 * conversations; reverted in hotfix 8.5.1). Any change here requires
 * the browser probe: after a send, questionVisualY ≈ 8px.
 *
 * USER MANDATE (this session, stored in RULES.md §15):
 * "Scroll on Message Send" — the send anchor is performed by a
 * CONTROLLED smooth scroll (distance-tuned ≈320–650ms easeOutCubic
 * rAF animation): fast, natural, ChatGPT-like. It is NEVER a jump to
 * the absolute bottom and NEVER a hard cut, and it works even when
 * the user was scrolled far up. The run — the thought chain with it —
 * starts ONLY when this scroll has ARRIVED (send-scroll-gate):
 *   send() arms the gate → this effect scrolls + releases on arrival
 *   → runCompletion starts the chain. User wheel/touch input cancels
 *   the animation (their scroll wins) and releases the gate.
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Controlled smooth scroll for the send anchor (user mandate, RULES.md
 * §15): distance-tuned ≈320–650ms easeOutCubic — fast, natural, and it
 * NEVER targets the bottom; the new question lands pinned at the top.
 * Real user input (wheel/touch) cancels the animation mid-flight — the
 * user's scroll always wins. Returns the finish/cancel handle.
 */
function animateScrollerTo(
  el: HTMLElement,
  top: number,
  onDone: () => void,
): () => void {
  const start = el.scrollTop;
  const delta = top - start;
  if (Math.abs(delta) < 1) {
    onDone();
    return () => {};
  }
  const distance = Math.abs(delta);
  const duration = Math.min(650, Math.max(320, distance * 0.35));
  const t0 = performance.now();
  let raf = 0;
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    el.removeEventListener("wheel", finish);
    el.removeEventListener("touchstart", finish);
    onDone();
  };
  el.addEventListener("wheel", finish, { passive: true });
  el.addEventListener("touchstart", finish, { passive: true });
  const step = (now: number): void => {
    if (finished) return;
    if (!el.isConnected) {
      // The view went away mid-flight — never keep mutating a dead node.
      finish();
      return;
    }
    const progress = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.scrollTop = start + delta * eased;
    if (progress < 1) raf = requestAnimationFrame(step);
    else finish();
  };
  raf = requestAnimationFrame(step);
  return finish;
}

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
  /**
   * Anchor hold: while TRUE the auto-follower stands down entirely — the
   * viewport stays EXACTLY where the anchor put it while the chain and the
   * answer grow below it (the ChatGPT behavior the user asked for: the
   * reply appears in place, the view never shifts while it is written;
   * the user scrolls when THEY want to). Set when a user message is
   * anchored; reset on conversation switch.
   */
  const anchorHoldRef = useRef(false);
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
    anchorHoldRef.current = false;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [switchSeq]);

  /**
   * New user message (appended AFTER mount) → anchor it to the top of the
   * viewport. When the document is too short to scroll that far, a
   * generation spacer is reserved below so the anchor lands exactly; the
   * spacer collapses (scroll-compensated) once the run finishes. History
   * on mount/conversation-switch never anchors.
   *
   * User mandate (RULES.md §15): the anchor scroll is CONTROLLED and
   * SMOOTH (never a bottom jump, never a hard cut) and the send-scroll
   * gate is released on arrival — the thought chain starts only then.
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
    // The question is now the viewport's anchor: the view holds THIS
    // position while the response is written below it.
    anchorHoldRef.current = true;
    const target = Math.max(0, element.offsetTop - ANCHOR_PAD_PX);
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (target <= maxScroll) {
      // Enough room below already — anchor directly, no spacer needed.
      pendingAnchorTargetRef.current = null;
      if (prefersReduced) {
        scroller.scrollTop = target;
        releaseSendScrollGate();
        return;
      }
      animateScrollerTo(scroller, target, releaseSendScrollGate);
      return;
    }
    // Reserve the missing room, then anchor once it exists (layout effect).
    pendingAnchorTargetRef.current = target;
    setAnchorSpacer(target - maxScroll + ANCHOR_SPACER_BUFFER_PX);
  }, [messages, prefersReduced]);

  /**
   * Spacer transitions — ONE owner: on growth it performs the pending
   * anchor (pre-paint, no flicker). On shrink (run finished — the answer
   * now occupies the reserved room) the view is left EXACTLY where the
   * user has it: no re-anchor jump, the browser merely clamps if the
   * reserved room disappears under the viewport.
   */
  useLayoutEffect(() => {
    const previous = prevSpacerRef.current;
    prevSpacerRef.current = anchorSpacer;
    const el = scrollerRef.current;
    if (!el) return;
    if (anchorSpacer < previous) return; // silent collapse — no view shift
    const target = pendingAnchorTargetRef.current;
    if (target === null) return;
    pendingAnchorTargetRef.current = null;
    if (prefersReduced) {
      el.scrollTop = target;
      releaseSendScrollGate();
      return;
    }
    animateScrollerTo(el, target, releaseSendScrollGate);
  }, [anchorSpacer, prefersReduced]);

  /**
   * Auto-follow the newest content — only when the user is near the bottom
   * AND no anchor holds the view. After a send, the question is anchored at
   * the top and the response grows BELOW it without ever moving the view
   * (the user scrolls when they want to — their scroll position is never
   * fought over). At a TERMINAL state this effect also stands down.
   */
  useEffect(() => {
    if (runIsTerminal) return;
    if (anchorHoldRef.current) return;
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
        {messages.map((message, index) => {
          if (message.role === "user") {
            return (
              // PROTECTED anchor contract (RULES §15): wrappers keep REAL
              // layout — placeholder sizing breaks the offsetTop math.
              <div key={message.id} data-message-id={message.id} className="min-w-0">
                <UserMessage message={message} />
              </div>
            );
          }
          // The user text that triggered this assistant run (nearest user
          // message above it) — drives the casual-prompt chain behavior.
          let triggerPrompt = "";
          for (let i = index - 1; i >= 0; i -= 1) {
            const candidate = messages[i];
            if (candidate.role === "user") {
              triggerPrompt = candidate.content;
              break;
            }
          }
          return (
            // PROTECTED anchor contract (RULES §15): wrappers keep REAL
            // layout — placeholder sizing breaks the offsetTop math.
            <div key={message.id} data-message-id={message.id} className="min-w-0">
              <AssistantMessage
                message={message}
                conversationId={conversationId}
                isLast={index === messages.length - 1}
                isGenerating={isGenerating}
                onRegenerate={regenerate}
                triggerPrompt={triggerPrompt}
              />
            </div>
          );
        })}
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
