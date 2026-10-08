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
 *
 * Agent Mode V2 (file-targeting follow-up): a "Choose a file" picker opens
 * the REAL repository file list (same source the composer's attach popover
 * uses) so the user can answer "which file?" by SELECTING it instead of
 * typing an exact name the run could not resolve itself.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileCode2,
  FolderOpen,
  HelpCircle,
  Loader2,
  MessageSquareReply,
  PauseCircle,
} from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type {
  IntakeAnswer,
  IntakeQuestionBatch,
} from "@/features/workspace/assistant/contracts";
import type { RepoTreeNode } from "@/features/workspace/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/** Flatten the repo tree into a searchable file-path list. */
function flattenFilePaths(nodes: RepoTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "file") {
      out.push(node.path);
    } else if (Array.isArray(node.children) && node.children.length > 0) {
      flattenFilePaths(node.children, out);
    }
  }
  return out;
}

const MAX_PICKER_RESULTS = 60;

/** One "Choose a file" popover: real workspace files + search. */
function FilePickerPopover({
  onPick,
  disabled,
  questionId,
}: {
  onPick: (path: string) => void;
  disabled?: boolean;
  questionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    const controller = new AbortController();
    void (async () => {
      setStatus("loading");
      try {
        const res = await fetch("/api/repository/tree", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; tree?: RepoTreeNode[] }
          | null;
        const list =
          data?.ok && Array.isArray(data.tree) ? flattenFilePaths(data.tree) : null;
        if (list === null) {
          setStatus("error");
          loadedRef.current = false; // allow a retry on the next open
          return;
        }
        setFiles(list);
        setStatus("ready");
      } catch {
        setStatus("error");
        loadedRef.current = false; // allow a retry on the next open
      }
    })();
    return () => controller.abort();
  }, [open]);

  const results = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    const matches = q
      ? files.filter((path) => path.toLowerCase().includes(q))
      : files;
    return matches.slice(0, MAX_PICKER_RESULTS);
  }, [files, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
          aria-label="Choose a file from the repository"
        >
          <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
          Choose a file
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5" aria-label="Repository files">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search repository files…"
          aria-label={`Search repository files for ${questionId}`}
          className="mb-1 h-7 w-full rounded-md border border-border-subtle bg-surface px-2 text-[11px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary/50"
        />
        <div className="max-h-56 overflow-y-auto">
          {status === "loading" && (
            <p className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              Loading files…
            </p>
          )}
          {status === "error" && (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              File tree unavailable right now — type the file name instead.
            </p>
          )}
          {status === "ready" && results.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">No files match.</p>
          )}
          {results.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                onPick(path);
                setOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-left font-mono text-[11px] text-foreground/90 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <FileCode2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{path}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
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
                  <div className="ml-5 mt-2 flex items-center gap-1.5">
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
                    <FilePickerPopover
                      questionId={question.id}
                      disabled={submitting}
                      onPick={(path) => {
                        setCustoms((c) => ({ ...c, [question.id]: path }));
                        setSelections((s) => {
                          const next = { ...s };
                          delete next[question.id];
                          return next;
                        });
                      }}
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
