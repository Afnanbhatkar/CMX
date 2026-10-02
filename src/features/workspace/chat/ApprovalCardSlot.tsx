"use client";

/**
 * CodeMind X V2 — ApprovalCardSlot (Phase 2 contract slot, spec §24).
 *
 * Renders an approval request card ONLY when an approval object is provided.
 * Phase 2 chat produces no approvals (no autonomous actions exist yet), so in
 * practice this renders null — the slot exists so later phases can drop real
 * approval flows into the conversation without re-plumbing every message.
 * No fake approvals are ever synthesized (RULES.md §9).
 */

import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChatApproval {
  id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  onApprove?: () => void;
  onReject?: () => void;
}

export interface ApprovalCardSlotProps {
  approval?: ChatApproval;
}

const SEVERITY_CLASSES: Record<ChatApproval["severity"], string> = {
  low: "border-info/40 text-info",
  medium: "border-warning/40 text-warning",
  high: "border-danger/40 text-danger",
};

export function ApprovalCardSlot({ approval }: ApprovalCardSlotProps) {
  if (!approval) return null;

  return (
    <div
      role="group"
      aria-label="Approval request"
      className="my-2 rounded-lg border border-border-subtle bg-surface-elevated p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {approval.title}
        </span>
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            SEVERITY_CLASSES[approval.severity],
          )}
        >
          {approval.severity}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        {approval.description}
      </p>
      {(approval.onApprove || approval.onReject) && (
        <div className="mt-2 flex gap-2">
          {approval.onApprove && (
            <Button size="sm" onClick={approval.onApprove}>
              Approve
            </Button>
          )}
          {approval.onReject && (
            <Button size="sm" variant="outline" onClick={approval.onReject}>
              Reject
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
