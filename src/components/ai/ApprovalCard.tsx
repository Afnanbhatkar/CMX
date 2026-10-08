"use client";

/**
 * CodeMind X V2 — ApprovalCard (Phase 8C).
 *
 * Native CodeMind reconstruction of the 21st.dev approval-card reference
 * (per the 8C spec): a decision surface for a proposed change, showing what
 * will happen, why, the affected files, risk, permission, expected tests
 * and security impact — with Review / Approve / Reject / Edit actions.
 *
 * Honesty (RULES.md §6/§9): this card records the human decision and can
 * open affected files in the editor. ChangeSet application is NOT connected
 * in this build — every decision states plainly that nothing was modified.
 * The blast-radius area is a reserved slot (no fake graph).
 */

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Pencil,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type { ApprovalDecision, ApprovalRequest } from "@/features/workspace/assistant/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BlastRadiusSlot } from "./BlastRadiusSlot";

export interface ApprovalCardProps {
  approval: ApprovalRequest;
  decision: ApprovalDecision | null;
  /** Called with the user's decision (the caller records it on the message).
   *  `excludePaths` carries the files the user removed with the per-chip ✕ —
   *  the server discards them before the change-set is applied. */
  onDecision: (
    decision: ApprovalDecision,
    extras?: { excludePaths?: string[] },
  ) => void;
  disabled?: boolean;
}

const DECISION_BANNER: Record<
  Exclude<ApprovalDecision, never>,
  { tone: string; icon: typeof Check; text: string }
> = {
  approved: {
    tone: "border-success/40 bg-success/5 text-success",
    icon: Check,
    text: "Approved — applying the change-set to the workspace now, then verifying every written file.",
  },
  rejected: {
    tone: "border-danger/40 bg-danger/5 text-danger",
    icon: X,
    text: "Rejected — no files were changed. The change-set was discarded.",
  },
  edited: {
    tone: "border-info/40 bg-info/5 text-info",
    icon: Pencil,
    text: "Edit — the affected files were opened in the editor for review. The run stays paused until you approve or reject.",
  },
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-start gap-2">
      <span className="pt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </span>
      <div className="min-w-0 text-[12px] leading-relaxed text-foreground/85">{children}</div>
    </div>
  );
}

export function ApprovalCard({ approval, decision, onDecision, disabled }: ApprovalCardProps) {
  /** Review toggles the full detail region (why / permission / tests / security / blast radius). */
  const [reviewing, setReviewing] = useState(false);
  /** Per-file opt-out (the ✕ on a file chip): files the user removed will
   *  NOT be changed when this approval is approved. Reversible until the
   *  decision lands. */
  const [excludedPaths, setExcludedPaths] = useState<string[]>([]);

  const lockChips = disabled || decision !== null;

  const remainingFiles = useMemo(
    () => approval.affectedFiles.filter((p) => !excludedPaths.includes(p)),
    [approval.affectedFiles, excludedPaths],
  );

  /** Honest per-kind counts for what WILL be applied (exclusions removed). */
  const counts = useMemo(() => {
    const kindOf = (path: string): "add" | "modify" | "delete" =>
      approval.changes?.find((c) => c.path === path)?.changeKind ?? "modify";
    return {
      created: remainingFiles.filter((p) => kindOf(p) === "add").length,
      modified: remainingFiles.filter((p) => kindOf(p) === "modify").length,
      deleted: remainingFiles.filter((p) => kindOf(p) === "delete").length,
    };
  }, [remainingFiles, approval.changes]);

  const excludeFile = (path: string) => {
    setExcludedPaths((paths) =>
      paths.includes(path) ? paths : [...paths, path],
    );
  };
  const restoreFile = (path: string) => {
    setExcludedPaths((paths) => paths.filter((p) => p !== path));
  };

  const openAffectedFile = async (path: string) => {
    await editorNavigation.openFile(path, "manual");
  };

  const handleEdit = async () => {
    onDecision("edited");
    const first = remainingFiles[0];
    if (first) await openAffectedFile(first);
  };

  const banner = decision ? DECISION_BANNER[decision] : null;

  return (
    <div
      role="group"
      aria-label="Approval requested for a proposed change"
      data-testid="approval-card"
      className="my-2 overflow-hidden rounded-xl border border-warning/30 bg-surface-elevated shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-warning/5 px-3 py-2.5">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">Approval needed</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {remainingFiles.length} file
            {remainingFiles.length === 1 ? "" : "s"} · {approval.requestedPermission}
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-warning/40 text-warning"
        >
          {counts.created} created · {counts.modified} modified · {counts.deleted} deleted
        </Badge>
      </div>

      {/* Body */}
      <div className="space-y-2.5 px-3 py-3">
        <DetailRow label="What">
          <span className="font-medium">{approval.whatWillChange}</span>
        </DetailRow>
        <DetailRow label="Files">
          <div className="flex flex-wrap gap-1">
            {remainingFiles.map((path) => (
              <span
                key={path}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-background pl-2 pr-0.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors"
              >
                <button
                  type="button"
                  onClick={() => void openAffectedFile(path)}
                  title={`Open ${path} in the editor`}
                  className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground"
                >
                  <FileCode2 aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">{path}</span>
                </button>
                {!lockChips && (
                  <button
                    type="button"
                    onClick={() => excludeFile(path)}
                    title={`Do not change ${path} — remove it from this change-set`}
                    aria-label={`Do not change ${path}`}
                    data-testid={`approval-exclude-${path}`}
                    className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                )}
              </span>
            ))}
            {remainingFiles.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                every file was removed — nothing will be changed
              </span>
            )}
          </div>
          {excludedPaths.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-muted-foreground/80">
                will NOT be changed:
              </span>
              {excludedPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => restoreFile(path)}
                  title={`Restore ${path} to this change-set`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-danger/30 bg-danger/5 pl-2 pr-1 py-0.5 font-mono text-[10px] text-danger transition-colors hover:bg-danger/10"
                >
                  <span className="truncate line-through">{path}</span>
                  <RotateCcw aria-hidden="true" className="size-3 shrink-0" aria-label={`Restore ${path}`} />
                </button>
              ))}
            </div>
          )}
        </DetailRow>

        {reviewing && (
          <div className="space-y-2.5 rounded-lg border border-border-subtle/70 bg-background/60 p-2.5">
            <DetailRow label="Why">
              {approval.whyApprovalNeeded}
            </DetailRow>
            <DetailRow label="Permission">
              <span className="font-mono text-[11px]">{approval.requestedPermission}</span>
            </DetailRow>
            <DetailRow label="Tests">
              {approval.expectedTests.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4">
                  {approval.expectedTests.map((t) => (
                    <li key={t} className="font-mono text-[11px]">{t}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">
                  none specified by the proposal
                </span>
              )}
            </DetailRow>
            <DetailRow label="Security">
              {approval.securityImpact || (
                <span className="text-muted-foreground">
                  no security impact stated by the proposal
                </span>
              )}
            </DetailRow>
            <BlastRadiusSlot />
          </div>
        )}
      </div>

      {/* Decision banner (after the human decided) */}
      {banner && (
        <div
          className={cn(
            "mx-3 mb-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed",
            banner.tone,
          )}
          data-testid="approval-decision-banner"
        >
          <banner.icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{banner.text}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle bg-background/40 px-3 py-2.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => setReviewing((v) => !v)}
          className="h-7 gap-1 px-2 text-[11px]"
          aria-expanded={reviewing}
        >
          {reviewing ? (
            <ChevronUp aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          )}
          Review
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || decision === "approved" || remainingFiles.length === 0}
          onClick={() =>
            onDecision(
              "approved",
              excludedPaths.length > 0 ? { excludePaths: [...excludedPaths] } : undefined,
            )
          }
          title={
            remainingFiles.length === 0
              ? "Every file was removed — reject this change-set instead"
              : undefined
          }
          className="h-7 gap-1 px-2.5 text-[11px]"
          data-testid="approval-approve"
        >
          <Check aria-hidden="true" className="size-3.5" />
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || decision === "rejected"}
          onClick={() => onDecision("rejected")}
          className="h-7 gap-1 border-danger/40 px-2.5 text-[11px] text-danger hover:bg-danger/5"
          data-testid="approval-reject"
        >
          <ShieldX aria-hidden="true" className="size-3.5" />
          Reject
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void handleEdit()}
          className="h-7 gap-1 px-2.5 text-[11px]"
        >
          <Pencil aria-hidden="true" className="size-3.5" />
          Edit
        </Button>
      </div>
    </div>
  );
}
