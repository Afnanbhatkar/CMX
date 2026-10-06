"use client";

/**
 * CodeMind X V2 — Phase 8.5 ResponseView: the structured response renderer.
 *
 * Renders the TYPED StructuredResponse payload — never application state
 * parsed out of the markdown body:
 *   template strip → summary → body (real markdown w/ typed code metadata)
 *   → claims with uncertainty badges (each badge reveals its evidence)
 *   → verified file references (clickable ONLY when the verifier confirmed
 *     them; unknown references are plain text + an "Unknown Reference"
 *     badge — a false clickable link is never created)
 *   → verified symbols → followups → overall uncertainty → verification
 *     footer with the rule-based critic findings.
 */

import { memo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  ListChecks,
  ShieldQuestion,
} from "lucide-react";

import type {
  EvidenceBackedClaim,
  ResponseTemplate,
  StructuredResponse,
  UncertaintyLevel,
} from "@/features/workspace/assistant/contracts";
import { FileReferenceChip } from "@/features/workspace/components/FileReferenceChip";
import { useChatUiStore } from "./chat-ui-store";
import { ChatMarkdown } from "./ChatMarkdown";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Template section vocabulary (8.5 §5)                                */
/* ------------------------------------------------------------------ */

const SECTIONS: Record<
  ResponseTemplate,
  { summary: string; claims: string; files: string; followups: string; flow: string[] }
> = {
  explain: {
    summary: "TL;DR",
    claims: "Key claims",
    files: "Key files",
    followups: "Gotchas & next steps",
    flow: ["TL;DR", "Flow", "Key files", "Gotchas"],
  },
  debug: {
    summary: "Root cause",
    claims: "Evidence",
    files: "Key files",
    followups: "Verify",
    flow: ["Root cause", "Evidence", "Fix", "Verify"],
  },
  review: {
    summary: "Summary",
    claims: "Findings",
    files: "Key files",
    followups: "Suggested next steps",
    flow: ["Findings", "Severity", "Suggested fix"],
  },
  architecture: {
    summary: "Overview",
    claims: "Relationships",
    files: "Components",
    followups: "Next steps",
    flow: ["Graph", "Components", "Relationships"],
  },
  general: {
    summary: "Summary",
    claims: "Claims",
    files: "Files",
    followups: "Next steps",
    flow: ["Summary", "Details"],
  },
};

const UNCERTAINTY_META: Record<UncertaintyLevel, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "border-success/50 text-success bg-success/10" },
  likely: { label: "Likely", className: "border-primary/50 text-primary bg-primary/10" },
  potential: { label: "Potential", className: "border-warning/50 text-warning bg-warning/10" },
  unknown: { label: "Unknown", className: "border-destructive/50 text-destructive bg-destructive/10" },
};

/* ------------------------------------------------------------------ */
/* Uncertainty badge (click → evidence)                                */
/* ------------------------------------------------------------------ */

function UncertaintyBadge({ claim }: { claim: EvidenceBackedClaim }) {
  const [open, setOpen] = useState(false);
  const meta = UNCERTAINTY_META[claim.uncertainty];
  return (
    <span className="inline-flex max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          meta.className,
        )}
        title="Show the evidence behind this label"
        data-testid={`uncertainty-badge-${claim.uncertainty}`}
      >
        {claim.uncertainty === "confirmed" ? (
          <BadgeCheck aria-hidden="true" className="size-3" />
        ) : claim.uncertainty === "unknown" ? (
          <ShieldQuestion aria-hidden="true" className="size-3" />
        ) : (
          <AlertTriangle aria-hidden="true" className="size-3" />
        )}
        {meta.label}
        {open ? (
          <ChevronDown aria-hidden="true" className="size-2.5" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-2.5 opacity-70" />
        )}
      </button>
      {open && (
        <span
          className="rounded-md border border-border-subtle bg-background/70 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground"
          data-testid="uncertainty-evidence"
        >
          <span className="font-medium text-foreground/80">Evidence: </span>
          {claim.evidence ?? "No evidence was produced for this claim."}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Section helpers                                                     */
/* ------------------------------------------------------------------ */

function SectionHeading({ icon: Icon, children }: { icon: typeof ListChecks; children: React.ReactNode }) {
  return (
    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon aria-hidden="true" className="size-3" />
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export const ResponseView = memo(function ResponseView({
  structured,
  content,
}: {
  structured: StructuredResponse;
  /** The full markdown body (the streamed answer — rendered as-is). */
  content: string;
}) {
  const sections = SECTIONS[structured.template] ?? SECTIONS.general;
  const setDraft = useChatUiStore((s) => s.setDraft);
  const [criticOpen, setCriticOpen] = useState(false);

  const verifiedFiles = structured.files.filter((f) => f.status === "verified");
  const unknownFiles = structured.files.filter((f) => f.status === "unknown");

  return (
    <div className="min-w-0" data-testid="response-view">
      {/* Template strip — the section flow this answer follows (8.5 §5). */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1" data-testid="response-template-strip">
        <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-primary">
          {structured.template}
        </span>
        {sections.flow.map((section, i) => (
          <span key={section} className="flex items-center gap-1 text-[9px] text-muted-foreground/70">
            {i > 0 && <span aria-hidden="true">→</span>}
            <span>{section}</span>
          </span>
        ))}
      </div>

      {/* Summary (typed) */}
      {structured.summary ? (
        <div
          className="mb-2 rounded-lg border border-border-subtle bg-surface p-2"
          data-testid="response-summary"
        >
          <SectionHeading icon={ListChecks}>{sections.summary}</SectionHeading>
          <p className="text-[13px] leading-relaxed text-foreground/95">{structured.summary}</p>
        </div>
      ) : null}

      {/* The real streamed body — code fences receive their typed metadata. */}
      <ChatMarkdown content={content} codeMeta={structured.code} />

      {/* Claims with honest uncertainty badges (8.5 §4). */}
      {structured.claims.length > 0 ? (
        <div className="mt-3" data-testid="response-claims">
          <SectionHeading icon={ListChecks}>{sections.claims}</SectionHeading>
          <ul className="space-y-1.5">
            {structured.claims.map((claim, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface/60 p-2">
                <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-foreground/90">
                    {claim.statement}
                  </p>
                  <UncertaintyBadge claim={claim} />
                </div>
                {verifiedFiles.some((f) => claim.evidence?.includes(f.raw) || claim.evidence?.includes(f.path)) ? (
                  <div className="flex flex-wrap gap-1">
                    {verifiedFiles
                      .filter((f) => claim.evidence?.includes(f.raw) || claim.evidence?.includes(f.path))
                      .slice(0, 3)
                      .map((file) => (
                        <FileReferenceChip
                          key={file.raw}
                          path={file.path}
                          line={file.line ?? undefined}
                          endLine={file.lineEnd ?? undefined}
                          source="chat"
                          size="sm"
                        />
                      ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* File references — verified = real clickable chips; unknown = honest badge. */}
      {structured.files.length > 0 ? (
        <div className="mt-3" data-testid="response-files">
          <SectionHeading icon={BadgeCheck}>{sections.files}</SectionHeading>
          <div className="flex flex-wrap gap-1">
            {verifiedFiles.map((file) => (
              <span key={file.raw} className="inline-flex items-center gap-1">
                <FileReferenceChip
                  path={file.path}
                  line={file.line ?? undefined}
                  endLine={file.lineEnd ?? undefined}
                  source="chat"
                  size="sm"
                />
                {file.lineCount !== null ? (
                  <span className="font-mono text-[9px] text-muted-foreground/60" title="Verified by the reference verifier">
                    {file.lineCount}L
                  </span>
                ) : null}
              </span>
            ))}
            {unknownFiles.map((file) => (
              <span
                key={file.raw}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-destructive/40 bg-destructive/5 px-2 py-0.5"
                title={file.note ?? "This reference could not be verified in the workspace."}
                data-testid="unknown-reference"
              >
                <FileQuestion aria-hidden="true" className="size-3 shrink-0 text-destructive" />
                <span className="truncate font-mono text-[10.5px] text-muted-foreground">{file.path}</span>
                <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-destructive">
                  Unknown Reference
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Symbols */}
      {structured.symbols.length > 0 ? (
        <div className="mt-3" data-testid="response-symbols">
          <SectionHeading icon={BadgeCheck}>Symbols</SectionHeading>
          <div className="flex flex-wrap gap-1">
            {structured.symbols.map((symbol) =>
              symbol.status === "verified" ? (
                <span
                  key={symbol.name}
                  className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/90"
                  title={`Verified definition: ${symbol.path}${symbol.line ? `:${symbol.line}` : ""} (${symbol.kind ?? "symbol"})`}
                >
                  <Check aria-hidden="true" className="size-3 text-success" />
                  {symbol.name}
                </span>
              ) : (
                <span
                  key={symbol.name}
                  className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
                  title="Not found in the workspace symbol table — treated as unverified."
                >
                  <FileQuestion aria-hidden="true" className="size-3 text-destructive/70" />
                  {symbol.name}
                </span>
              ),
            )}
          </div>
        </div>
      ) : null}

      {/* Followups / gotchas — clicking loads it into the composer draft. */}
      {structured.followups.length > 0 ? (
        <div className="mt-3" data-testid="response-followups">
          <SectionHeading icon={ListChecks}>{sections.followups}</SectionHeading>
          <div className="flex flex-wrap gap-1">
            {structured.followups.map((followup, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setDraft(followup)}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title="Load this into the composer draft"
              >
                {followup}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Overall uncertainty + verification footer (8.5 §3/§4 honesty). */}
      <div
        className={cn(
          "mt-3 rounded-lg border-l-2 bg-surface/50 p-2",
          structured.uncertainty.level === "confirmed" && "border-l-success",
          structured.uncertainty.level === "likely" && "border-l-primary",
          structured.uncertainty.level === "potential" && "border-l-warning",
          structured.uncertainty.level === "unknown" && "border-l-destructive",
        )}
        data-testid="response-uncertainty"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
              UNCERTAINTY_META[structured.uncertainty.level].className,
            )}
          >
            {UNCERTAINTY_META[structured.uncertainty.level].label}
          </span>
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            {structured.uncertainty.reason}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-muted-foreground/70">
          <span data-testid="verification-counts">
            {structured.verification.verifiedCount} verified · {structured.verification.unknownCount} unknown
          </span>
          <span>·</span>
          <span className="font-mono">{structured.verification.via}</span>
          {structured.memoryUsed.length > 0 ? (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5">
                <Brain aria-hidden="true" className="size-2.5" />
                memory: {structured.memoryUsed.slice(0, 2).map((m) => m.label).join(", ")}
                {structured.memoryUsed.length > 2 ? ` +${structured.memoryUsed.length - 2}` : ""}
              </span>
            </>
          ) : null}
          {structured.verification.criticNotes.length > 0 ? (
            <>
              <span>·</span>
              <button
                type="button"
                onClick={() => setCriticOpen((v) => !v)}
                aria-expanded={criticOpen}
                className="underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                critic notes ({structured.verification.criticNotes.length})
              </button>
            </>
          ) : null}
          {structured.verification.note ? (
            <>
              <span>·</span>
              <span className="text-warning/80">{structured.verification.note}</span>
            </>
          ) : null}
        </div>
        {criticOpen ? (
          <ul className="mt-1.5 space-y-1 border-t border-border-subtle pt-1.5" data-testid="critic-notes">
            {structured.verification.criticNotes.map((note, i) => (
              <li key={i} className="text-[10.5px] leading-relaxed text-muted-foreground">
                — {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
});
