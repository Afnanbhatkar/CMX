"use client";

/**
 * CodeMind X V2 — ThoughtChain (AI activity reference component)
 *
 * Vertical chain of execution steps: status rail (dot + connector line),
 * category icon, and a short privacy-safe system-activity label.
 *
 * PRIVACY CONTRACT: this component renders ONLY the `label` text it is
 * given. It must never receive or display private model chain-of-thought —
 * callers pass category kinds + short system messages ("Searching
 * repository…") per ARCHITECTURE.md §8.
 *
 * Independently replaceable per the reference component contract.
 */

import { motion, useReducedMotion } from "framer-motion";
import {
  Brain,
  CheckCheck,
  Code2,
  FileText,
  FlaskConical,
  GitBranch,
  ListTree,
  Network,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import type { ActivityKind } from "@/types/contracts";

export type ThoughtStepStatus = "pending" | "active" | "done" | "error";

export interface ThoughtStep {
  id: string;
  kind: ActivityKind;
  /** Short privacy-safe system-activity message. */
  label: string;
  status: ThoughtStepStatus;
}

export interface ThoughtChainProps {
  steps: ThoughtStep[];
  /** Dense = smaller rows for embedding inside chat bubbles / panels. Default false. */
  dense?: boolean;
  className?: string;
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

export function ThoughtChain({
  steps,
  dense = false,
  className,
}: ThoughtChainProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  return (
    <ul role="list" className={cn("m-0 list-none p-0", className)}>
      {steps.map((step, index) => {
        const Icon = KIND_ICON[step.kind];
        const isLast = index === steps.length - 1;
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

            {/* Row content: category icon + privacy-safe label only. */}
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2",
                dense ? "py-0.5" : "py-1",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  dense ? "size-3" : "size-3.5",
                  ICON_TONE[step.status],
                )}
              />
              <span
                className={cn(
                  "min-w-0 truncate font-mono transition-colors duration-150",
                  dense ? "text-[11px]" : "text-xs",
                  LABEL_TONE[step.status],
                )}
              >
                {step.label}
              </span>
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}
