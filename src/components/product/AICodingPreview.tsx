"use client";

/**
 * CodeMind X V2 — AI coding preview (Phase 1, spec §56).
 *
 * Concept visual of the ChangeSet workflow: a step rail (Request → … →
 * Apply) that progresses active→done once on scroll-in, a proposed diff,
 * and the verify row whose Apply control is intentionally disabled —
 * AI proposes, a human reviews, the system verifies. The diff and test
 * counts are illustrative demo data inside a labeled concept frame.
 */
import type { ComponentType, ReactNode } from "react";
import {
  Brain,
  Check,
  FileDiff,
  ListTree,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CODE_PALETTE, PreviewFrame, StatusDot } from "./shared";

/* ── Local demo data ─────────────────────────────────────────────────── */

const STAGES = [
  { label: "Request", icon: MessageSquare },
  { label: "Understand context", icon: Brain },
  { label: "Plan", icon: ListTree },
  { label: "Proposed change", icon: FileDiff },
  { label: "Verify", icon: ShieldCheck },
  { label: "Apply", icon: Check },
] as const;

/** Steps 0–3 end done, step 4 (Verify) stays active, Apply stays pending. */
type StepState = "done" | "active" | "pending";

const stateFor = (i: number): StepState =>
  i < 4 ? "done" : i === 4 ? "active" : "pending";

const LABEL_CLASS: Record<StepState, string> = {
  done: "text-foreground/75",
  active: "text-primary",
  pending: "text-muted-foreground/50",
};

/**
 * Node colors for the framer sequence (rgb strings — framer interpolates
 * these; they approximate the --primary / surface / border-subtle tokens).
 */
const NODE_COLORS: Record<StepState, { bg: string; border: string; fg: string }> = {
  done: { bg: "rgba(214, 209, 200, 0.07)", border: "rgba(214, 209, 200, 0.16)", fg: "#d6d1c8" },
  active: { bg: "rgba(200, 121, 65, 0.14)", border: "rgba(200, 121, 65, 0.45)", fg: "#dd9d5b" },
  pending: { bg: "rgba(214, 209, 200, 0.00)", border: "rgba(214, 209, 200, 0.10)", fg: "rgba(214, 209, 200, 0.45)" },
};

const ACTIVE = NODE_COLORS.active;
const STEP_DELAY = 0.18;

/* ── Variants (one whileInView-triggered sequence, settles) ──────────── */

const stepVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * STEP_DELAY,
      duration: motionDuration.base,
      ease: motionEase.outSoft,
    },
  }),
};

const nodeVariants: Variants = {
  hidden: { backgroundColor: ACTIVE.bg, borderColor: ACTIVE.border, color: ACTIVE.fg },
  show: (i: number) => {
    const state = stateFor(i);
    const target = NODE_COLORS[state];
    if (state !== "done") {
      return {
        backgroundColor: target.bg,
        borderColor: target.border,
        color: target.fg,
        transition: {
          delay: i * STEP_DELAY,
          duration: motionDuration.base,
          ease: motionEase.outSoft,
        },
      };
    }
    // active → done: enter copper, hold briefly, settle to neutral done
    return {
      backgroundColor: [ACTIVE.bg, ACTIVE.bg, target.bg],
      borderColor: [ACTIVE.border, ACTIVE.border, target.border],
      color: [ACTIVE.fg, ACTIVE.fg, target.fg],
      transition: { delay: i * STEP_DELAY, duration: 0.6, times: [0, 0.45, 1], ease: motionEase.outSoft },
    };
  },
};

/* ── Diff line helpers ───────────────────────────────────────────────── */

const K = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.keyword }}>{children}</span>
);
const F = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.fn }}>{children}</span>
);
const T = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.type }}>{children}</span>
);
const Pn = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.punctuation }}>{children}</span>
);

type DiffKind = "ctx" | "del" | "add";

function DiffLine({ kind, children }: { kind: DiffKind; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-2 px-2 py-px",
        kind === "ctx" && "text-muted-foreground",
        kind === "del" && "bg-danger/10 text-danger/90",
        kind === "add" && "bg-success/10 text-success/90",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "w-2 shrink-0 select-none text-center",
          kind === "del" ? "text-danger" : kind === "add" ? "text-success" : "text-muted-foreground/50",
        )}
      >
        {kind === "del" ? "−" : kind === "add" ? "+" : " "}
      </span>
      <span className="whitespace-pre">{children}</span>
    </div>
  );
}

/* ── Component ───────────────────────────────────────────────────────── */

export function AICodingPreview({ className }: { className?: string }) {
  const prefersReduced = Boolean(useReducedMotion());

  return (
    <PreviewFrame title="changeset — checkout validation" className={className}>
      <div className="space-y-3 p-3">
        {/* Step rail — vertical on mobile, horizontal steps on md+ */}
        <motion.ol
          initial={prefersReduced ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          aria-label="ChangeSet workflow steps"
          className="flex flex-col gap-1.5 rounded-sm border border-border-subtle bg-surface-elevated/40 p-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-1.5"
        >
          {STAGES.map((stage, i) => {
            const Icon: ComponentType<{ className?: string }> = stage.icon;
            const state = stateFor(i);
            return (
              <motion.li
                key={stage.label}
                custom={i}
                variants={stepVariants}
                className="flex items-center gap-1.5"
              >
                <motion.span
                  custom={i}
                  variants={nodeVariants}
                  className="flex size-6 shrink-0 items-center justify-center rounded-sm border"
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </motion.span>
                <span className={cn("whitespace-nowrap text-[10.5px] font-medium", LABEL_CLASS[state])}>
                  {stage.label}
                </span>
              </motion.li>
            );
          })}
        </motion.ol>

        {/* Proposed diff */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{
            duration: prefersReduced ? 0 : motionDuration.base,
            delay: prefersReduced ? 0 : 0.35,
            ease: motionEase.outSoft,
          }}
          className="overflow-hidden rounded-sm border border-border-subtle bg-[#131110]"
        >
          <div className="border-b border-border-subtle px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
            services/checkout.ts
          </div>
          <div className="overflow-x-auto p-1.5 font-mono text-[10.5px] leading-relaxed">
            <DiffLine kind="ctx">
              <K>export</K> <K>async</K> <K>function</K> <F>createCheckout</F>
              <Pn>(</Pn>cart: <T>Cart</T>
              <Pn>{") {"}</Pn>
            </DiffLine>
            <DiffLine kind="del">{"  const charge = cart.total;"}</DiffLine>
            <DiffLine kind="del">{"  return chargeWithCard(charge);"}</DiffLine>
            <DiffLine kind="add">{"  const charge = validateTotal(cart.total, cart.coupon);"}</DiffLine>
            <DiffLine kind="add">{`  if (!charge.ok) return reject("invalid_total");`}</DiffLine>
            <DiffLine kind="add">{"  return chargeWithCard(charge.value);"}</DiffLine>
            <DiffLine kind="ctx">
              <Pn>{"}"}</Pn>
            </DiffLine>
          </div>
        </motion.div>

        {/* Verify status + approval contract */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-2.5">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone="success" />
            <span className="font-mono text-[10px] text-muted-foreground">
              Verified · 4 tests passed · 0 security findings
            </span>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2.5">
            <span className="text-[10px] text-muted-foreground">
              AI proposes · human reviews · system verifies
            </span>
            <Button size="sm" variant="secondary" disabled aria-label="Apply change — review required">
              Apply
            </Button>
          </span>
        </div>
      </div>
    </PreviewFrame>
  );
}
