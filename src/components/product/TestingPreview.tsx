"use client";

/**
 * CodeMind X V2 — Testing preview (Phase 1, spec §28).
 *
 * Concept visual of a test-intelligence panel: suite header, per-test
 * statuses with one expanded failure (root-cause chips), and a coverage
 * strip that fills once on scroll-in. Every quantity here (4 tests, 68%)
 * is synthetic and labeled as demo data — no real project metrics.
 */
import { CheckCircle2, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { DemoBadge, PreviewFrame } from "./shared";

/* ── Local demo data ─────────────────────────────────────────────────── */

const TESTS = [
  { name: "accepts valid token", state: "pass" },
  { name: "rejects expired token", state: "pass" },
  { name: "rejects tampered signature", state: "pass" },
  { name: "rejects cross-tenant token", state: "fail" },
] as const;

const COVERAGE = 68;

/* ── Component ───────────────────────────────────────────────────────── */

export function TestingPreview({ className }: { className?: string }) {
  const prefersReduced = Boolean(useReducedMotion());

  return (
    <PreviewFrame title="tests/auth.test.ts" hideBadge className={className}>
      <div className="p-3">
        {/* Suite header */}
        <div className="flex items-center gap-2 pb-2">
          <p className="font-mono text-[11px]">
            <span className="text-muted-foreground">auth › </span>
            <span className="text-foreground">verifyRequest</span>
          </p>
          <span className="ml-auto">
            <DemoBadge label="Synthetic" />
          </span>
        </div>

        {/* Test rows — tiny stagger, settles */}
        <ul className="space-y-1">
          {TESTS.map((test, i) => {
            const failed = test.state === "fail";
            return (
              <motion.li
                key={test.name}
                initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{
                  duration: prefersReduced ? 0 : motionDuration.base,
                  delay: prefersReduced ? 0 : i * 0.06,
                  ease: motionEase.outSoft,
                }}
                className={cn(
                  "rounded-sm border px-2.5 py-1.5",
                  failed
                    ? "border-danger/25 bg-danger/5"
                    : "border-border-subtle bg-surface-elevated/40",
                )}
              >
                <div className="flex items-center gap-2">
                  {failed ? (
                    <XCircle className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                  )}
                  <span className="font-mono text-[11px] text-foreground">{test.name}</span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 font-mono text-[10px]",
                      failed ? "text-danger/90" : "text-muted-foreground",
                    )}
                  >
                    {failed ? "fail" : "pass"}
                  </span>
                </div>

                {failed && (
                  <div className="mt-1.5 space-y-1.5 rounded-sm border border-danger/20 bg-surface px-2 py-1.5">
                    <p className="font-mono text-[10px] text-danger/90">
                      expected 403, received 200
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-sm border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        Affected function: verifyRequest()
                      </span>
                      <span className="rounded-sm border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] text-warning">
                        Regression risk: medium
                      </span>
                    </div>
                  </div>
                )}
              </motion.li>
            );
          })}
        </ul>

        {/* Coverage strip — width fills once on inView */}
        <div className="space-y-1.5 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
            <motion.div
              initial={{ width: prefersReduced ? `${COVERAGE}%` : "0%" }}
              whileInView={{ width: `${COVERAGE}%` }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{
                duration: prefersReduced ? 0 : 0.9,
                delay: prefersReduced ? 0 : 0.35,
                ease: motionEase.outSoft,
              }}
              className="h-full rounded-full bg-success/70"
            />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            coverage {COVERAGE}% · selected function
          </p>
        </div>
      </div>
    </PreviewFrame>
  );
}
