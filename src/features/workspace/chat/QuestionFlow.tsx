"use client";

/**
 * CodeMind X V2 — QuestionFlow (Phase 8C §6).
 *
 * Renders the intake question batch the run paused on. The run resumes ONLY
 * after the user answers every question — pause → ask → resume is the whole
 * contract. Related decisions are batched at the beginning (one pause, never
 * repeated tiny interruptions).
 *
 * The example interaction from the spec: "I found two authentication
 * implementations. Which one should I modify?" with one button per real
 * candidate file — exactly what the backend's retrieval-driven heuristic
 * produces.
 */

import { useState } from "react";
import { HelpCircle, MessageSquareReply, PauseCircle } from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type {
  IntakeAnswer,
  IntakeQuestionBatch,
} from "@/features/workspace/assistant/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface QuestionFlowProps {
  batch: IntakeQuestionBatch;
  /** Persisted answers (empty while the run is still paused). */
  answers: IntakeAnswer[];
  /** Submit the full answer set — resumes the paused run. */
  onAnswer: (answers: IntakeAnswer[]) => void;
  /** True while the resume round-trip is in flight. */
  submitting?: boolean;
}

export function QuestionFlow({ batch, answers, onAnswer, submitting }: QuestionFlowProps) {
  const answered = answers.length > 0;
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customs, setCustoms] = useState<Record<string, string>>({});

  const allAnswered = batch.questions.every(
    (q) => selections[q.id] !== undefined || (customs[q.id] ?? "").trim().length > 0,
  );

  const submit = () => {
    const payload: IntakeAnswer[] = [];
    for (const q of batch.questions) {
      const custom = (customs[q.id] ?? "").trim();
      if (custom) {
        payload.push({ questionId: q.id, optionId: null, customText: custom });
      } else if (selections[q.id] !== undefined) {
        payload.push({ questionId: q.id, optionId: selections[q.id], customText: null });
      }
    }
    if (payload.length === batch.questions.length) onAnswer(payload);
  };

  return (
    <div
      role="group"
      aria-label={answered ? "Intake questions answered" : "The assistant needs your input"}
      data-testid="question-flow"
      className="my-1.5 rounded-xl border border-primary/25 bg-surface-elevated p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        {answered ? (
          <MessageSquareReply aria-hidden="true" className="size-4 shrink-0 text-success" />
        ) : (
          <PauseCircle aria-hidden="true" className="size-4 shrink-0 animate-pulse text-primary motion-reduce:animate-none" />
        )}
        <span className="text-[12px] font-medium">
          {answered ? "Answered — the run resumed" : "Paused — the assistant needs a decision"}
        </span>
      </div>

      {batch.rationale && (
        <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {batch.rationale}
        </p>
      )}

      <div className="space-y-3">
        {batch.questions.map((question) => {
          const answer = answers.find((a) => a.questionId === question.id);
          return (
            <div key={question.id} className="rounded-lg border border-border-subtle bg-background/50 p-2.5">
              <div className="flex items-start gap-1.5">
                <HelpCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-[12px] font-medium leading-relaxed">{question.question}</p>
              </div>

              {answer ? (
                <p className="ml-5 mt-1.5 rounded-md border border-success/30 bg-success/5 px-2 py-1 text-[11px] text-success">
                  {answer.optionId
                    ? question.options.find((o) => o.id === answer.optionId)?.label ?? answer.optionId
                    : answer.customText}
                </p>
              ) : (
                <>
                  <div className="ml-5 mt-2 flex flex-wrap gap-1.5">
                    {question.options.map((option) => {
                      const selected = selections[question.id] === option.id;
                      return (
                        <Button
                          key={option.id}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          disabled={submitting}
                          onClick={() => {
                            setSelections((s) => ({ ...s, [question.id]: option.id }));
                            setCustoms((c) => ({ ...c, [question.id]: "" }));
                          }}
                          title={option.value}
                          className={cn(
                            "h-7 max-w-full gap-1 px-2 text-[11px]",
                            selected && "font-medium",
                          )}
                        >
                          <span className="truncate">{option.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                  <div className="ml-5 mt-2 flex gap-1.5">
                    <Input
                      value={customs[question.id] ?? ""}
                      onChange={(e) => {
                        setCustoms((c) => ({ ...c, [question.id]: e.target.value }));
                        setSelections((s) => {
                          const next = { ...s };
                          delete next[question.id];
                          return next;
                        });
                      }}
                      placeholder="Or type your own answer…"
                      disabled={submitting}
                      className="h-7 border-border-subtle text-[11px]"
                      aria-label={`Custom answer for: ${question.question}`}
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {!answered && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/80">
            The run stays paused until you answer.
          </span>
          <Button
            type="button"
            size="sm"
            disabled={!allAnswered || submitting}
            onClick={submit}
            className="h-7 px-3 text-[11px]"
            data-testid="question-flow-resume"
          >
            {submitting ? "Resuming…" : "Resume run"}
          </Button>
        </div>
      )}
    </div>
  );
}
