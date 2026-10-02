"use client";

/**
 * CodeMind X V2 — Git preview (Phase 1, spec §29).
 *
 * Concept visual of git intelligence: a branch line with recent commits,
 * the selected commit showing changed files, plus related-symbol and
 * impact chips. All commits, shas and counts are sample data (labeled) —
 * no real repository activity is represented.
 */
import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { DemoBadge, PreviewFrame } from "./shared";

/* ── Local demo data ─────────────────────────────────────────────────── */

const COMMITS = [
  { sha: "7c2e9a4", message: "fix: reject cross-tenant token", selected: true },
  { sha: "b81f03d", message: "feat: checkout sessions", selected: false },
  { sha: "5d4c8e2", message: "chore: bump deps", selected: false },
  { sha: "e90a176", message: "refactor: auth middleware", selected: false },
] as const;

const SELECTED_FILES = [
  { path: "services/auth.ts", additions: "+12", deletions: "−3" },
  { path: "tests/auth.test.ts", additions: "+24", deletions: "−0" },
] as const;

const RELATED_SYMBOLS = ["verifyRequest", "AuthMiddleware"] as const;

/* ── Component ───────────────────────────────────────────────────────── */

export function GitPreview({ className }: { className?: string }) {
  const prefersReduced = Boolean(useReducedMotion());

  return (
    <PreviewFrame title="git — recent activity" badge={<DemoBadge label="Sample" />} className={className}>
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
        {/* Branch line + commit nodes */}
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-[5px] top-2 border-l border-border-subtle"
          />
          <ol className="space-y-1.5">
            {COMMITS.map((commit) => (
              <li key={commit.sha} className="relative flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 mt-1 inline-block size-[11px] shrink-0 rounded-full",
                    commit.selected
                      ? "bg-primary ring-1 ring-primary/50 ring-offset-2 ring-offset-surface"
                      : "border-2 border-muted-foreground/30 bg-surface",
                  )}
                />
                {commit.selected ? (
                  /* Selected commit — highlighted card with changed files */
                  <div className="flex-1 rounded-sm border border-primary/25 bg-surface-elevated px-2.5 py-2">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start">
                      <div className="min-w-0 md:w-44 md:shrink-0">
                        <p className="font-mono text-[10px] text-primary">{commit.sha}</p>
                        <p className="mt-0.5 truncate text-xs text-foreground" title={commit.message}>
                          {commit.message}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1 border-border-subtle md:border-l md:pl-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Changed files
                        </p>
                        {SELECTED_FILES.map((file) => (
                          <div key={file.path} className="flex items-baseline gap-2 font-mono text-[10.5px]">
                            <span className="truncate text-foreground">{file.path}</span>
                            <span className="ml-auto shrink-0 text-success">{file.additions}</span>
                            <span className="shrink-0 text-danger">{file.deletions}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 pt-0.5">
                    <p className="font-mono text-[10px] text-primary">{commit.sha}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{commit.message}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* Related symbols + impact signal */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Related symbols
          </span>
          {RELATED_SYMBOLS.map((symbol) => (
            <span
              key={symbol}
              className="rounded-sm border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-foreground"
            >
              {symbol}
            </span>
          ))}
          <span className="ml-auto rounded-sm border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Impact: 2 callers
          </span>
        </div>
      </motion.div>
    </PreviewFrame>
  );
}
