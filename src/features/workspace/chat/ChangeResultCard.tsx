"use client";

/**
 * CodeMind X V2 — ChangeResultCard (Agent Mode V2, spec §21/§22/§82).
 *
 * The CHAT-side result surface for a REAL, applied, verified change-set:
 * what was created/modified/deleted (machine-generated from actual disk
 * operations — never model-summarized), the honest validation lines, and
 * the three result controls:
 *
 *   [Open file]  → editor navigation (the REAL editor, not a preview)
 *   [View diff]  → the actual line diff computed from before/after disk
 *                  content (bounded, expandable per file)
 *   [Edit]       → prefills the composer to request the next modification
 *                  on that file
 *
 * Approval does NOT live here — it stays inside the thought chain (§3).
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  FileCode2,
  FilePlus2,
  FileX2,
  Pencil,
  ShieldCheck,
} from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import { useChatUiStore } from "./chat-ui-store";
import type { ChangeResultSummary } from "@/features/workspace/assistant/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ResultRow({
  icon,
  path,
  verified,
  tone,
}: {
  icon: React.ReactNode;
  path: string;
  verified?: boolean;
  tone: string;
}) {
  return (
    <button
      type="button"
      className="group flex w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left hover:bg-surface-hover"
      onClick={() => void editorNavigation.openFile(path, "change-result")}
      title={`Open ${path} in the editor`}
    >
      <span className={cn("shrink-0", tone)} aria-hidden="true">
        {icon}
      </span>
      <span className="truncate font-mono text-[11px] text-foreground/85 group-hover:text-foreground">
        {path}
      </span>
      {verified === false ? (
        <span className="ml-auto shrink-0 text-[10px] font-medium text-danger">
          unverified
        </span>
      ) : verified === true ? (
        <CircleCheck aria-hidden="true" className="ml-auto size-3 shrink-0 text-success" />
      ) : null}
    </button>
  );
}

function DiffBlock({
  entry,
}: {
  entry: { path: string; lines: { kind: "add" | "remove" | "same"; text: string }[] | null };
}) {
  if (!entry.lines || entry.lines.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border-subtle">
      <div className="border-b border-border-subtle bg-surface-elevated px-2 py-1 font-mono text-[10px] text-muted-foreground">
        {entry.path}
      </div>
      <pre className="max-h-56 overflow-auto bg-surface px-2 py-1.5 font-mono text-[10.5px] leading-[1.55]">
        {entry.lines.slice(0, 220).map((line, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre",
              line.kind === "add" && "bg-success/10 text-success",
              line.kind === "remove" && "bg-danger/10 text-danger",
              line.kind === "same" && "text-foreground/60",
            )}
          >
            <span className="select-none opacity-60">
              {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function ChangeResultCard({ result }: { result: ChangeResultSummary }) {
  const [showDiff, setShowDiff] = useState(false);
  const setDraft = useChatUiStore((s) => s.setDraft);

  const total =
    result.created.length + result.modified.length + result.deleted.length;
  const allVerified = result.created.every((f) => f.verified) && result.modified.every((f) => f.verified);
  const failed = result.error !== null || result.conflict !== null || !allVerified;

  const editTarget = result.modified[0]?.path ?? result.created[0]?.path ?? null;

  return (
    <div
      role="group"
      aria-label="Applied change result"
      data-testid="change-result-card"
      className={cn(
        "my-2 overflow-hidden rounded-xl border shadow-sm",
        failed ? "border-warning/40 bg-warning/[0.03]" : "border-success/30 bg-success/[0.03]",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
        {failed ? (
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-warning" />
        ) : (
          <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            {result.conflict
              ? "Change not applied — version conflict"
              : failed
                ? "Changes partially applied"
                : `${total} file${total === 1 ? "" : "s"} changed`}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {result.conflict
              ? result.conflict
              : failed
                ? (result.error ?? "Some changes could not be verified.")
                : "Applied after approval · verified by re-reading every file"}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          {result.created.length}C · {result.modified.length}M · {result.deleted.length}D
        </span>
      </div>

      {/* Files */}
      <div className="space-y-1 px-3 py-2.5">
        {result.created.length > 0 ? (
          <div>
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Created
            </p>
            {result.created.map((file) => (
              <ResultRow
                key={`c-${file.path}`}
                icon={<FilePlus2 className="size-3.5" />}
                path={file.path}
                verified={file.verified}
                tone="text-success"
              />
            ))}
          </div>
        ) : null}
        {result.modified.length > 0 ? (
          <div>
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Modified
            </p>
            {result.modified.map((file) => (
              <ResultRow
                key={`m-${file.path}`}
                icon={<FileCode2 className="size-3.5" />}
                path={file.path}
                verified={file.verified}
                tone="text-primary"
              />
            ))}
          </div>
        ) : null}
        {result.deleted.length > 0 ? (
          <div>
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Deleted
            </p>
            {result.deleted.map((file) => (
              <ResultRow
                key={`d-${file.path}`}
                icon={<FileX2 className="size-3.5" />}
                path={file.path}
                verified={file.verified}
                tone="text-danger"
              />
            ))}
          </div>
        ) : null}

        {/* Validation — honest: skipped checks say skipped (spec §39/§135). */}
        {result.validation.length > 0 ? (
          <div className="pt-1">
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Validation
            </p>
            {result.validation.map((check) => (
              <p key={`${check.path}-${check.name}`} className="text-[11px] leading-relaxed">
                <span
                  className={cn(
                    "mr-1 font-medium",
                    check.status === "passed" && "text-success",
                    check.status === "failed" && "text-danger",
                    check.status === "skipped" && "text-warning",
                  )}
                >
                  {check.status === "passed" ? "✓" : check.status === "failed" ? "×" : "⚠"}
                </span>
                {check.name} — {check.status}
                {check.detail ? (
                  <span className="text-muted-foreground"> ({check.detail})</span>
                ) : null}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* Controls (spec §23/§24/§99) */}
      <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => {
            const first =
              result.modified[0]?.path ?? result.created[0]?.path ?? null;
            if (first) void editorNavigation.openFile(first, "change-result");
          }}
        >
          <FileCode2 aria-hidden="true" className="size-3" />
          Open file
        </Button>
        {result.diffs && result.diffs.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[11px]"
            aria-expanded={showDiff}
            onClick={() => setShowDiff((v) => !v)}
          >
            {showDiff ? (
              <ChevronUp aria-hidden="true" className="size-3" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3" />
            )}
            View diff
          </Button>
        ) : null}
        {editTarget ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => {
              // Spec §23: "Edit" means request the NEXT modification — the
              // composer is prefilled with the file as the active target.
              setDraft(`Edit \`${editTarget}\`: `);
            }}
          >
            <Pencil aria-hidden="true" className="size-3" />
            Edit
          </Button>
        ) : null}
      </div>

      {showDiff && result.diffs ? (
        <div className="space-y-2 border-t border-border-subtle px-3 py-2.5">
          {result.diffs.map((entry) => (
            <DiffBlock key={entry.path} entry={entry} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
