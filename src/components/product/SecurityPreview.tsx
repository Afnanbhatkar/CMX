"use client";

/**
 * CodeMind X V2 — Security preview (Phase 1, spec §27).
 *
 * Concept visual of a security finding card: severity, affected files, the
 * request path with the affected hop highlighted, and a code evidence
 * excerpt. All content is clearly-labeled illustrative demo data (see the
 * DemoBadge) — no real findings, repos, or metrics.
 */
import { Fragment } from "react";
import { ChevronRight, Eye, FileCode2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { CODE_PALETTE, DemoBadge, PreviewFrame } from "./shared";

/* ── Local demo data ─────────────────────────────────────────────────── */

const AFFECTED_HOP = "middleware";

const REQUEST_HOPS = ["request", "middleware", "controller", "service"] as const;

const AFFECTED_FILES = ["auth/middleware.ts", "api/users.ts"] as const;

/* ── Tiny inline token helpers (CODE_PALETTE colors) ─────────────────── */

const K = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.keyword }}>{children}</span>
);
const F = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.fn }}>{children}</span>
);
const T = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.type }}>{children}</span>
);
const C = ({ children }: { children: string }) => (
  <span style={{ color: CODE_PALETTE.comment }}>{children}</span>
);

/* ── Component ───────────────────────────────────────────────────────── */

export function SecurityPreview({ className }: { className?: string }) {
  const prefersReduced = Boolean(useReducedMotion());

  return (
    <PreviewFrame title="security/finding — SEC-1042" hideBadge className={className}>
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{
          duration: prefersReduced ? 0 : motionDuration.base,
          ease: motionEase.outSoft,
        }}
        className="space-y-3 p-3"
      >
        {/* Finding header */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-sm border border-danger/30 bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-danger">
            High
          </span>
          <h3 className="text-sm font-medium text-foreground">
            Potential authorization boundary issue
          </h3>
          <span className="ml-auto">
            <DemoBadge />
          </span>
        </div>

        {/* Affected files */}
        <div className="overflow-hidden rounded-sm border border-border-subtle bg-surface-elevated/50">
          {AFFECTED_FILES.map((path) => (
            <div
              key={path}
              className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 last:border-b-0"
            >
              <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono text-[11px] text-foreground">{path}</span>
            </div>
          ))}
        </div>

        {/* Request path — affected hop highlighted */}
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Request path
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {REQUEST_HOPS.map((hop, i) => (
              <Fragment key={hop}>
                {i > 0 && (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[10px]",
                    hop === AFFECTED_HOP
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border-subtle bg-surface-elevated text-muted-foreground",
                  )}
                >
                  {hop}
                </span>
              </Fragment>
            ))}
          </div>
        </div>

        {/* Evidence excerpt */}
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Evidence
          </p>
          <pre className="overflow-x-auto rounded-sm border border-border-subtle bg-[#131110] p-2 font-mono text-[10px] leading-relaxed">
            <code>
              <K>export</K> <K>async</K> <K>function</K> <F>findUser</F>
              <span style={{ color: CODE_PALETTE.punctuation }}>(</span>
              req: <T>Request</T>
              <span style={{ color: CODE_PALETTE.punctuation }}>) {"{"}</span>
              {"\n  "}
              <K>const</K> user = <K>await</K> users.<F>get</F>
              <span style={{ color: CODE_PALETTE.punctuation }}>(</span>req.params.id
              <span style={{ color: CODE_PALETTE.punctuation }}>)</span>
              {"\n  "}
              <C>{`// missing tenant check — record returned for any caller`}</C>
            </code>
          </pre>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
          <span className="text-[11px] text-muted-foreground">Recommended review</span>
          <span className="inline-flex items-center gap-1 rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">
            <Eye className="size-3" aria-hidden="true" />
            Review before merge
          </span>
        </div>
      </motion.div>
    </PreviewFrame>
  );
}
