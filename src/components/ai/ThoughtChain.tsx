"use client";

/**
 * CodeMind X V2 — ThoughtChain (AI activity reference component, Phase 8B).
 *
 * Odyssey-style vertical execution timeline: status rail (dot + connector
 * line), category icon, title, and — since 8B — the full progressive
 * disclosure contract:
 *
 * - states: done / active / pending (+ honest "error"),
 * - steps that carry child detail items (safe tool summaries) or a one-line
 *   outcome render a TRIGGER with a chevron; click expands/collapses,
 * - the ACTIVE step is expanded by default; completed steps start collapsed
 *   unless the user opens them (per-step override wins while mounted),
 * - the active title carries a shimmer sweep + an "In progress" badge
 *   (both disabled under prefers-reduced-motion),
 * - child rows render execution facts (✓ / ● / ○) — e.g.
 *   `read_file src/auth/session.ts ✓`.
 *
 * PRIVACY CONTRACT: this component renders ONLY the labels/children it is
 * given. It must never receive or display private model chain-of-thought —
 * callers pass category kinds + short system messages ("Searching
 * repository…") per ARCHITECTURE.md §8.
 *
 * Independently replaceable per the reference component contract.
 */

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Brain,
  CheckCheck,
  ChevronRight,
  Code2,
  FileText,
  FlaskConical,
  GitBranch,
  ListTree,
  Network,
  Rocket,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import type { ActivityKind } from "@/types/contracts";

export type ThoughtStepStatus = "pending" | "active" | "done" | "error";

/** One safe execution fact under a step (tool summary, never reasoning). */
export interface ThoughtStepChild {
  id: string;
  /** Short safe fact ("read_file src/auth/session.ts"). */
  label: string;
  status: ThoughtStepStatus;
}

export interface ThoughtStep {
  id: string;
  kind: ActivityKind;
  /** Short privacy-safe system-activity message (the step title). */
  label: string;
  status: ThoughtStepStatus;
  /** One-line safe outcome ("14 relevant results") shown when expanded. */
  detail?: string | null;
  /** Safe tool-summary children (execution facts only). */
  children?: ThoughtStepChild[];
}

export interface ThoughtChainProps {
  steps: ThoughtStep[];
  /** Dense = smaller rows for embedding inside chat bubbles / panels. Default false. */
  dense?: boolean;
  className?: string;
  /**
   * Odyssey progressive disclosure (default true): steps with detail/children
   * become collapsible triggers; the active step starts expanded, completed
   * steps start collapsed. Set false for a flat, always-expanded chain.
   */
  collapsible?: boolean;
}

/** ActivityKind → lucide icon (closed vocabulary, mirrors contracts.ts). */
const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  understanding: Brain,
  search: Search,
  read: FileText,
  plan: ListTree,
  code: Code2,
  test: FlaskConical,
  security: ShieldCheck,
  git: GitBranch,
  architecture: Network,
  finalize: CheckCheck,
  deployment: Rocket,
};

const DOT_TONE: Record<ThoughtStepStatus, string> = {
  pending: "border border-muted-foreground/40 bg-transparent",
  active: "bg-primary animate-pulse motion-reduce:animate-none",
  done: "bg-success",
  error: "bg-danger",
};

const ICON_TONE: Record<ThoughtStepStatus, string> = {
  pending: "text-muted-foreground/50",
  active: "text-primary",
  done: "text-muted-foreground",
  error: "text-danger",
};

const LABEL_TONE: Record<ThoughtStepStatus, string> = {
  pending: "text-muted-foreground/70",
  active: "text-foreground",
  done: "text-muted-foreground",
  error: "text-danger",
};

const CHILD_GLYPH: Record<ThoughtStepStatus, string> = {
  pending: "○",
  active: "●",
  done: "✓",
  error: "✕",
};

const CHILD_GLYPH_TONE: Record<ThoughtStepStatus, string> = {
  pending: "text-muted-foreground/50",
  active: "text-primary",
  done: "text-success",
  error: "text-danger",
};

/** Self-contained shimmer keyframes (active title sweep). */
const SHIMMER_KEYFRAMES = `
@keyframes cmx-thought-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Title text (+ shimmer + "In progress" badge on the active row). */
function StepTitle({
  step,
  dense,
  reduced,
}: {
  step: ThoughtStep;
  dense: boolean;
  reduced: boolean;
}) {
  const active = step.status === "active";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className={cn(
          "min-w-0 truncate font-mono transition-colors duration-150",
          dense ? "text-[11px]" : "text-xs",
          LABEL_TONE[step.status],
        )}
        style={
          active && !reduced
            ? {
                backgroundImage:
                  "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 50%, var(--muted-foreground) 100%)",
                backgroundSize: "200% 100%",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "transparent",
                animation: "cmx-thought-shimmer 2.2s linear infinite",
              }
            : undefined
        }
      >
        {step.label}
      </span>
      {active ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-background px-1.5 font-medium uppercase tracking-wide text-muted-foreground",
            dense ? "py-0 text-[8px]" : "py-0.5 text-[9px]",
          )}
        >
          <span
            aria-hidden="true"
            className="size-1 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
          />
          In progress
        </span>
      ) : null}
    </span>
  );
}

/** Expandable body: one-line outcome + safe child execution facts. */
function StepBody({
  step,
  dense,
  bodyId,
}: {
  step: ThoughtStep;
  dense: boolean;
  bodyId: string;
}) {
  return (
    <div id={bodyId} className={cn("min-w-0", dense ? "pl-5 pt-0.5" : "pl-6 pt-1")}>
      {step.detail ? (
        <p
          className={cn(
            "truncate text-muted-foreground",
            dense ? "text-[10px]" : "text-[11px]",
          )}
        >
          {step.detail}
        </p>
      ) : null}
      {step.children && step.children.length > 0 ? (
        <ul role="list" className="m-0 list-none space-y-0.5 p-0">
          {step.children.map((child) => (
            <li
              key={child.id}
              className={cn(
                "flex min-w-0 items-center gap-1.5 font-mono",
                dense ? "text-[10px]" : "text-[11px]",
                LABEL_TONE[child.status],
              )}
            >
              <span
                aria-hidden="true"
                className={cn("shrink-0", CHILD_GLYPH_TONE[child.status])}
              >
                {CHILD_GLYPH[child.status]}
              </span>
              <span className="min-w-0 truncate">{child.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chain                                                               */
/* ------------------------------------------------------------------ */

export function ThoughtChain({
  steps,
  dense = false,
  className,
  collapsible = true,
}: ThoughtChainProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);
  /** Per-step user overrides; undefined = use the Odyssey default. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const onToggle = useCallback((id: string, next: boolean) => {
    setOverrides((prev) => ({ ...prev, [id]: next }));
  }, []);

  return (
    <>
      {/* Keyframes live with the component so it stays self-contained. */}
      <style dangerouslySetInnerHTML={{ __html: SHIMMER_KEYFRAMES }} />
      <ul role="list" className={cn("m-0 list-none p-0", className)}>
        {steps.map((step, index) => {
          const Icon = KIND_ICON[step.kind];
          const isLast = index === steps.length - 1;

          const hasBody = Boolean(step.detail) || (step.children?.length ?? 0) > 0;
          const canExpand = collapsible && hasBody;
          // Odyssey defaults: active → expanded; everything else collapsed
          // until the user opens it (per-step override wins while mounted).
          const expanded = overrides[step.id] ?? step.status === "active";
          const bodyId = `thought-body-${step.id}`;

          return (
            <motion.li
              key={step.id}
              className="flex gap-2.5"
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduced ? 0 : motionDuration.base,
                ease: motionEase.outSoft,
                delay: reduced ? 0 : index * 0.03,
              }}
            >
              {/* Status rail: dot aligned to the first text line + connector. */}
              <span aria-hidden="true" className="flex w-2 shrink-0 flex-col items-center">
                <span className={cn("flex items-center", dense ? "py-0.5" : "py-1")}>
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full transition-colors duration-150",
                      DOT_TONE[step.status],
                    )}
                  />
                </span>
                {!isLast && <span className="w-px flex-1 bg-border-subtle" />}
              </span>

              {/* Row content. */}
              <div className={cn("min-w-0 flex-1", dense ? "py-0.5" : "py-1")}>
                {canExpand ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={() => onToggle(step.id, !expanded)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-[4px] text-left",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus",
                      "px-0.5 transition-colors hover:bg-surface-hover/60",
                    )}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none",
                        expanded && "rotate-90",
                      )}
                    />
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 transition-colors duration-150",
                        dense ? "size-3" : "size-3.5",
                        ICON_TONE[step.status],
                      )}
                    />
                    <StepTitle step={step} dense={dense} reduced={reduced} />
                  </button>
                ) : (
                  <span className="flex min-w-0 items-center gap-2 px-0.5">
                    <span aria-hidden="true" className="w-3 shrink-0" />
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 transition-colors duration-150",
                        dense ? "size-3" : "size-3.5",
                        ICON_TONE[step.status],
                      )}
                    />
                    <StepTitle step={step} dense={dense} reduced={reduced} />
                  </span>
                )}

                {canExpand && expanded ? (
                  <StepBody step={step} dense={dense} bodyId={bodyId} />
                ) : null}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </>
  );
}
