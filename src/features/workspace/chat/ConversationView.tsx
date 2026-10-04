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

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import { Check, Copy, FileCode2, Paperclip, RotateCcw } from "lucide-react";

import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Attachment, ChatMessage } from "@/features/workspace/types";
import {
  buildRunSteps,
  thoughtForLabel,
  useAssistantEngineSnapshot,
} from "@/features/workspace/assistant";
import { selectLedger, useContextInspectorStore } from "@/stores/context-inspector-store";
import { FileReferenceChip } from "@/features/workspace/components/FileReferenceChip";
import { ApprovalCard, LatticeLoader, ThinkingOrb, ThoughtChain } from "@/components/ai";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
/* Live run activity (Phase 8B)                                        */
/* ------------------------------------------------------------------ */

/**
 * The current run's backend-driven activity: Thought Chain from the engine
 * snapshot, with the reference LatticeLoader ("Thinking" + stopwatch) before
 * the first activity completes and the canvas ThinkingOrb pill ("Solving…")
 * once real work is running. While the run is PAUSED for intake questions
 * (8C), the QuestionFlow card replaces the loaders — the run resumes only
 * after the user answers.
 */
function RunActivityLive({
  conversationId,
  messageId,
  startedAt,
}: {
  conversationId: string;
  messageId: string;
  startedAt: number | null;
}) {
  const snapshot = useAssistantEngineSnapshot();
  const { answerIntake } = useAssistantRun();
  const [submitting, setSubmitting] = useState(false);

  // Only the LIVE run drives this view; history renders from the message's
  // persisted activity chain.
  if (snapshot.status !== "running" && snapshot.status !== "awaiting-answers") return null;

  const steps = buildRunSteps(snapshot);
  const anyCompleted = snapshot.activities.some((a) => a.status === "completed");
  const stopwatchOrigin = snapshot.startedAt ?? startedAt;
  const paused = snapshot.status === "awaiting-answers" && snapshot.questionBatch !== null;

  const handleAnswer = async (answers: Parameters<typeof answerIntake>[3]) => {
    if (!snapshot.runId) return;
    setSubmitting(true);
    try {
      await answerIntake(conversationId, messageId, snapshot.runId, answers);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-2 space-y-2" data-testid="run-activity-live">
      {steps.length > 0 ? <ThoughtChain steps={steps} dense /> : null}
      {paused && snapshot.questionBatch ? (
        <QuestionFlow
          batch={snapshot.questionBatch}
          answers={[]}
          onAnswer={(answers) => void handleAnswer(answers)}
          submitting={submitting}
        />
      ) : anyCompleted ? (
        <ThinkingOrb state="solving" label="Solving…" />
      ) : (
        <LatticeLoader cellSize={5} label="Thinking" startedAt={stopwatchOrigin} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
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
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
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
    <div className="max-w-[92%]">
      <div className="mb-1 flex items-center gap-1.5">
        {busy ? (
          <ThinkingOrb size={14} state="thinking" label="Assistant is thinking" />
        ) : (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Assistant
        </span>
        <time dateTime={message.createdAt} className="text-[10px] text-muted-foreground/70">
          {formatTime(message.createdAt)}
        </time>
      </div>

      {/* Phase 8B live run: backend-driven chain + reference indicators
          (LatticeLoader while thinking, canvas orb once work is running);
          Phase 8C: the run PAUSES here for intake questions. */}
      {busy && (
        <RunActivityLive
          conversationId={conversationId}
          messageId={message.id}
          startedAt={Date.parse(message.createdAt) || null}
        />
      )}

      {/* Persisted activity chain for history (engine-derived, safe only). */}
      {!busy && message.activity && message.activity.length > 0 && (
        <ThoughtChain steps={message.activity} dense className="mb-2" />
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
          {/* Phase 8B measured-run meta — honest numbers only. */}
          {(() => {
            const thoughtFor = thoughtForLabel(message.thoughtForMs ?? null);
            return thoughtFor ? (
              <span
                className="ml-1 rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/80"
                title="Measured total run duration"
              >
                {thoughtFor}
              </span>
            ) : null;
          })()}
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

export function ConversationView({ conversationId }: ConversationViewProps) {
  const conversation = useWorkspaceStore(
    (s) => s.conversations.find((c) => c.id === conversationId) ?? null,
  );
  const { regenerate, isGenerating } = useAssistantRun();
  const prefersReduced = useReducedMotion();
  const scrollHostRef = useRef<HTMLDivElement | null>(null);

  const messages = conversation?.messages ?? [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  /* Auto-scroll to the newest content when it actually changes. */
  useEffect(() => {
    const viewport = scrollHostRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, [messages.length, lastMessage?.state, lastMessage?.content, prefersReduced]);

  return (
    <div ref={scrollHostRef} className="min-h-0 flex-1">
      <ScrollArea className="h-full">
        <div className="space-y-4 p-3" aria-live="polite">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                conversationId={conversationId}
                isLast={index === messages.length - 1}
                isGenerating={isGenerating}
                onRegenerate={regenerate}
              />
            ),
          )}
          {messages.length === 0 && (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              No messages yet — ask something to start this conversation.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
