"use client";

/**
 * CodeMind X V2 — RepositoryPreview (Phase 1, Task 2-c)
 *
 * A repository-structure visualization: file tree with git status chips,
 * a selected file, an SVG overlay drawing dependency curves to related
 * files, and the symbols the (demo) assistant pulled into AI context.
 * All content is clearly-labeled sample data — never live repository state.
 */
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { FileCode2, Folder, Sparkles } from "lucide-react";
import { DemoBadge, PreviewFrame, StatusDot } from "@/components/product/shared";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export interface RepositoryPreviewProps {
  className?: string;
}

/* ── Sample data (clearly labeled via DemoBadge — not real repo state) ─ */

type TreeKind = "dir" | "file";
type TreeStatus = "M" | "A";

interface TreeRow {
  id: string;
  name: string;
  kind: TreeKind;
  depth: number;
  status?: TreeStatus;
  selected?: boolean;
}

const TREE_ROWS: TreeRow[] = [
  { id: "src", name: "src", kind: "dir", depth: 0 },
  { id: "components", name: "components", kind: "dir", depth: 1 },
  { id: "components/auth-dialog.tsx", name: "auth-dialog.tsx", kind: "file", depth: 2 },
  { id: "components/payment-form.tsx", name: "payment-form.tsx", kind: "file", depth: 2 },
  { id: "components/session-card.tsx", name: "session-card.tsx", kind: "file", depth: 2 },
  { id: "hooks", name: "hooks", kind: "dir", depth: 1 },
  { id: "hooks/use-session.ts", name: "use-session.ts", kind: "file", depth: 2 },
  { id: "hooks/use-payment.ts", name: "use-payment.ts", kind: "file", depth: 2 },
  { id: "lib", name: "lib", kind: "dir", depth: 1 },
  { id: "lib/result.ts", name: "result.ts", kind: "file", depth: 2 },
  { id: "lib/format.ts", name: "format.ts", kind: "file", depth: 2 },
  { id: "lib/logger.ts", name: "logger.ts", kind: "file", depth: 2 },
  { id: "services", name: "services", kind: "dir", depth: 1 },
  {
    id: "services/auth.ts",
    name: "auth.ts",
    kind: "file",
    depth: 2,
    status: "M",
    selected: true,
  },
  { id: "services/billing.ts", name: "billing.ts", kind: "file", depth: 2 },
  { id: "services/ledger.ts", name: "ledger.ts", kind: "file", depth: 2 },
  { id: "api", name: "api", kind: "dir", depth: 1 },
  { id: "api/users.ts", name: "users.ts", kind: "file", depth: 2 },
  { id: "api/checkout.ts", name: "checkout.ts", kind: "file", depth: 2, status: "A" },
  { id: "api/webhooks.ts", name: "webhooks.ts", kind: "file", depth: 2 },
  { id: "tests", name: "tests", kind: "dir", depth: 1 },
  { id: "tests/auth.test.ts", name: "auth.test.ts", kind: "file", depth: 2 },
  { id: "tests/billing.test.ts", name: "billing.test.ts", kind: "file", depth: 2 },
  { id: "config", name: "config", kind: "dir", depth: 1 },
  { id: "config/paths.ts", name: "paths.ts", kind: "file", depth: 2 },
  { id: "config/env.ts", name: "env.ts", kind: "file", depth: 2 },
];

/** A dependency curve: path data plus its measured endpoint. */
interface Link {
  d: string;
  ex: number;
  ey: number;
}

const SELECTED_ID = "services/auth.ts";
const DEPENDENCY_TARGET_IDS = ["services/billing.ts", "tests/auth.test.ts", "api/users.ts"];

const CONTEXT_SYMBOLS = ["verifyRequest()", "AuthMiddleware", "signToken()"];

const SEARCH_QUERY = "auth";

/** Wrap the search substring inside a file name in a highlighted <mark>. */
function renderHighlightedName(name: string): ReactNode {
  const idx = name.indexOf(SEARCH_QUERY);
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="rounded-[2px] bg-primary/25 px-0.5 text-foreground">
        {SEARCH_QUERY}
      </mark>
      {name.slice(idx + SEARCH_QUERY.length)}
    </>
  );
}

/* ── Sequence timing (runs once, settles) ───────────────────────────── */

const ROW_STAGGER_S = 0.018;
const LINE_BASE_DELAY_S = 0.55;
const LINE_STAGGER_S = 0.14;
const LINE_DURATION_S = 0.5;
const CHIP_DELAY_S = 1.5;

const rowVariants: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: {
      delay: i * ROW_STAGGER_S,
      duration: motionDuration.base,
      ease: motionEase.outSoft,
    },
  }),
};

const lineVariants: Variants = {
  hidden: { pathLength: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    transition: {
      delay: LINE_BASE_DELAY_S + i * LINE_STAGGER_S,
      duration: LINE_DURATION_S,
      ease: motionEase.inOut,
    },
  }),
};

const chipVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: CHIP_DELAY_S, duration: motionDuration.base, ease: motionEase.outSoft },
  },
};

/* ── Component ──────────────────────────────────────────────────────── */

export function RepositoryPreview({ className }: RepositoryPreviewProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  const registerRow = useCallback((id: string) => {
    return (el: HTMLDivElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    };
  }, []);

  /**
   * Measure the selected row and each dependency target relative to the
   * tree container, then build rightward-bulging bezier paths between
   * their right edges. Runs on mount, container resize, window resize
   * and after fonts settle.
   */
  const measure = useCallback(() => {
    const container = containerRef.current;
    const startEl = rowRefs.current.get(SELECTED_ID);
    if (!container || !startEl) return;

    const cRect = container.getBoundingClientRect();
    const sRect = startEl.getBoundingClientRect();
    const sx = sRect.right - cRect.left;
    const sy = sRect.top + sRect.height / 2 - cRect.top;

    const nextLinks: Link[] = [];
    for (const targetId of DEPENDENCY_TARGET_IDS) {
      const el = rowRefs.current.get(targetId);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const ex = r.right - cRect.left;
      const ey = r.top + r.height / 2 - cRect.top;
      const bulge = Math.max(26, Math.abs(ex - sx) * 0.45 + 14);
      const c1x = (sx + bulge).toFixed(1);
      const c2x = (ex + bulge).toFixed(1);
      nextLinks.push({
        d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x} ${sy.toFixed(1)}, ${c2x} ${ey.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
        ex,
        ey,
      });
    }

    setLinks(nextLinks);
    setSize({ width: cRect.width, height: cRect.height });
  }, []);

  useLayoutEffect(() => {
    // Defer the first measurement to a frame callback: layout is complete
    // by then, and setState stays out of the effect body.
    const frame = window.requestAnimationFrame(measure);
    const container = containerRef.current;
    const resizeObserver =
      container && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (resizeObserver && container) resizeObserver.observe(container);
    window.addEventListener("resize", measure);

    let cancelled = false;
    document.fonts?.ready
      .then(() => {
        if (!cancelled) measure();
      })
      .catch(() => {
        /* fonts API unavailable — initial measurement stands */
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const renderRow = (row: TreeRow, index: number) => {
    const icon =
      row.kind === "dir" ? (
        <Folder className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      ) : (
        <FileCode2 className="size-3 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      );
    return (
      <motion.div
        key={row.id}
        ref={registerRow(row.id)}
        variants={rowVariants}
        custom={index}
        className={cn(
          "flex h-5 w-fit items-center gap-1.5 border-l-2 border-l-transparent pl-1.5 pr-3 font-mono text-[11px]",
          row.selected && "border-primary bg-surface-hover",
        )}
      >
        {Array.from({ length: row.depth }).map((_, guideIdx) => (
          <span
            key={guideIdx}
            aria-hidden="true"
            className="w-3.5 self-stretch border-l border-border-subtle"
          />
        ))}
        {icon}
        <span
          className={cn(
            "whitespace-nowrap",
            row.selected ? "text-foreground" : row.kind === "dir" ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {renderHighlightedName(row.name)}
        </span>
        {row.status === "M" ? (
          <span
            title="Modified"
            className="rounded-sm bg-warning/15 px-1 font-mono text-[9px] leading-[14px] text-warning"
          >
            M
          </span>
        ) : null}
        {row.status === "A" ? (
          <span
            title="Added"
            className="rounded-sm bg-success/15 px-1 font-mono text-[9px] leading-[14px] text-success"
          >
            A
          </span>
        ) : null}
      </motion.div>
    );
  };

  return (
    <PreviewFrame
      title="acme-checkout/ · main"
      badge={<DemoBadge label="Sample" />}
      className={cn("w-full", className)}
    >
      <motion.div
        initial={reduced ? false : "hidden"}
        whileInView="visible"
        viewport={{ once: true, amount: 0.18 }}
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_188px]">
          {/* Tree panel — dependency overlay spans this container only */}
          <div ref={containerRef} className="relative px-3 py-3">
            {size.width > 0 && links.length > 0 ? (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${size.width} ${size.height}`}
                preserveAspectRatio="none"
              >
                <defs>
                  {links.map((link, i) => (
                    <mask
                      key={i}
                      id={`${uid}-dep-${i}`}
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width={size.width}
                      height={size.height}
                    >
                      <motion.path
                        d={link.d}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={6}
                        strokeLinecap="round"
                        variants={lineVariants}
                        custom={i}
                      />
                    </mask>
                  ))}
                </defs>
                {/* Dashed dependency curves revealed by the draw-in masks */}
                {links.map((link, i) => (
                  <path
                    key={i}
                    d={link.d}
                    fill="none"
                    stroke="rgba(217, 142, 74, 0.55)"
                    strokeWidth={1.25}
                    strokeDasharray="4 4"
                    mask={`url(#${uid}-dep-${i})`}
                  />
                ))}
                {links.map((link, i) => (
                  <circle
                    key={i}
                    cx={link.ex}
                    cy={link.ey}
                    r={2}
                    fill="rgba(217, 142, 74, 0.7)"
                  />
                ))}
              </svg>
            ) : null}
            <div className="flex flex-col">{TREE_ROWS.map(renderRow)}</div>
          </div>

          {/* Context card — right on md+, stacked below on mobile */}
          <aside className="flex flex-col gap-2 border-t border-border-subtle px-3 py-3 md:border-l md:border-t-0">
            <div className="flex items-center gap-1.5">
              <StatusDot tone="primary" />
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                AI context
              </h3>
            </div>
            <p
              className="truncate font-mono text-[10px] text-muted-foreground/70"
              title="services/auth.ts"
            >
              services/auth.ts
            </p>
            <div className="flex flex-wrap gap-1">
              {CONTEXT_SYMBOLS.map((symbol) => (
                <span
                  key={symbol}
                  className="rounded-sm border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-foreground/85"
                >
                  {symbol}
                </span>
              ))}
            </div>
            <p className="mt-auto pt-1 text-[10px] leading-relaxed text-muted-foreground/60">
              Symbols extracted from the selected file.
            </p>
          </aside>
        </div>

        {/* Bottom confirmation chip — slides in after the lines draw */}
        <motion.footer
          variants={chipVariants}
          className="flex items-center border-t border-border-subtle px-3 py-2"
        >
          <span className="inline-flex items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
            <Sparkles className="size-3" aria-hidden="true" />
            + Added to AI context
          </span>
        </motion.footer>
      </motion.div>
    </PreviewFrame>
  );
}
