"use client";

/**
 * CodeMind X V2 — Search preview (Phase 1, spec §55).
 *
 * Concept visual of hybrid retrieval: one query row and four result rows
 * (keyword / semantic / symbol / related) with matched substrings
 * highlighted. All paths and snippets are illustrative demo content.
 */
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { PreviewFrame } from "./shared";

/* ── Local demo data ─────────────────────────────────────────────────── */

type ResultKind = "Keyword" | "Semantic" | "Symbol" | "Related";

const KIND_CLASS: Record<ResultKind, string> = {
  Keyword: "text-foreground",
  Semantic: "text-info",
  Symbol: "text-primary",
  Related: "text-muted-foreground",
};

interface DemoResult {
  path: string;
  kind: ResultKind;
  snippet: ReactNode;
}

const Mark = ({ children }: { children: ReactNode }) => (
  <mark className="rounded-[2px] bg-primary/25 px-0.5 text-foreground">{children}</mark>
);

const RESULTS: DemoResult[] = [
  {
    path: "auth/middleware.ts",
    kind: "Keyword",
    snippet: (
      <>
        All requests are authenticated here; the <Mark>authentication</Mark> middleware
        guards every controller route.
      </>
    ),
  },
  {
    path: "services/auth.ts",
    kind: "Semantic",
    snippet: (
      <>
        Issues sessions and validates tokens; <Mark>handles expiry and signature checks</Mark>{" "}
        before a session is granted.
      </>
    ),
  },
  {
    path: "api/users.ts",
    kind: "Symbol",
    snippet: (
      <>
        Route handler for GET /users/:id, protected by <Mark>verifyRequest</Mark>()
        before the record is resolved.
      </>
    ),
  },
  {
    path: "tests/auth.test.ts",
    kind: "Related",
    snippet: (
      <>
        Tests for the <Mark>auth middleware</Mark>: expired tokens, tampered signatures and
        cross-tenant rejection.
      </>
    ),
  },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function SearchPreview({ className }: { className?: string }) {
  const prefersReduced = Boolean(useReducedMotion());

  return (
    <PreviewFrame title="search — hybrid retrieval" className={className}>
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{
          duration: prefersReduced ? 0 : motionDuration.base,
          ease: motionEase.outSoft,
        }}
        className="space-y-2 p-3"
      >
        {/* Query row */}
        <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-elevated px-2 py-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-[11px] text-foreground">
            {`"where is authentication handled?"`}
          </span>
        </div>

        {/* Results */}
        <ul className="space-y-1.5">
          {RESULTS.map((result) => (
            <li
              key={result.path}
              className="space-y-1 rounded-sm border border-border-subtle bg-surface-elevated/40 px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-foreground">{result.path}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-sm border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px]",
                    KIND_CLASS[result.kind],
                  )}
                >
                  {result.kind}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{result.snippet}</p>
            </li>
          ))}
        </ul>

        {/* Footer caption */}
        <p className="pt-0.5 font-mono text-[10px] text-muted-foreground">
          keyword + semantic + symbol fusion — concept preview
        </p>
      </motion.div>
    </PreviewFrame>
  );
}
